-- Apply a human-approved high-risk replacement to the existing public row.
-- The canonical creative ID, slug, and original published_at are preserved.

begin;

create table if not exists public.blog_information_replacements (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  target_creative_id uuid not null references public.content_creatives(id) on delete restrict,
  replacement_draft_id uuid not null references public.content_creatives(id) on delete restrict,
  review_case_id uuid not null references public.blog_information_review_cases(id) on delete restrict,
  representative_key text not null references public.blog_information_representatives(representative_key) on delete restrict,
  source_fingerprint char(64) not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_fingerprint char(64) not null check (canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_slug text not null check (btrim(canonical_slug) <> ''),
  indexing_job_id uuid not null references public.blog_indexing_jobs(id) on delete restrict,
  actor_id uuid not null,
  public_published_at timestamptz not null,
  previous_snapshot jsonb not null,
  replacement_snapshot jsonb not null,
  replaced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (replacement_draft_id, source_fingerprint)
);

create index if not exists idx_blog_information_replacements_target
  on public.blog_information_replacements (target_creative_id, replaced_at desc);
create index if not exists idx_blog_information_replacements_review_case
  on public.blog_information_replacements (review_case_id);
create index if not exists idx_blog_information_replacements_representative
  on public.blog_information_replacements (representative_key);
create index if not exists idx_blog_information_replacements_indexing_job
  on public.blog_information_replacements (indexing_job_id);

alter table public.blog_information_replacements enable row level security;
revoke all on table public.blog_information_replacements from public, anon, authenticated;
grant select, insert on table public.blog_information_replacements to service_role;

drop policy if exists blog_information_replacements_service_role
  on public.blog_information_replacements;
create policy blog_information_replacements_service_role
  on public.blog_information_replacements
  for all to service_role using (true) with check (true);

alter table public.blog_information_review_events
  drop constraint if exists blog_information_review_events_action_check;
alter table public.blog_information_review_events
  add constraint blog_information_review_events_action_check check (action in (
    'research_validated', 'research_missing', 'approved', 'changes_requested',
    'rejected', 'publish_revalidated', 'published', 'replacement_applied'
  ));

create or replace function public.replace_blog_information_reviewed_draft_atomically(
  p_replacement_draft_id uuid,
  p_target_creative_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_source_fingerprint char(64),
  p_validation_meta jsonb,
  p_quality_gate jsonb,
  p_representative_key text,
  p_idempotency_key text
)
returns table (
  target_creative_id uuid,
  replacement_draft_id uuid,
  slug text,
  published_at timestamptz,
  representative_key text,
  replacement_id uuid,
  indexing_job_id uuid,
  idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.content_creatives%rowtype;
  v_target public.content_creatives%rowtype;
  v_case public.blog_information_review_cases%rowtype;
  v_target_case public.blog_information_review_cases%rowtype;
  v_representative public.blog_information_representatives%rowtype;
  v_replacement public.blog_information_replacements%rowtype;
  v_source_fingerprint text;
  v_canonical_fingerprint text;
  v_quality_gate jsonb;
  v_claim_validation jsonb;
  v_replacement_contract jsonb;
  v_brief jsonb;
  v_target_case_id uuid;
  v_job_id uuid;
  v_claim_count integer := 0;
  v_url text;
  v_now timestamptz := now();
begin
  if p_actor_id is null
    or p_replacement_draft_id is null
    or p_target_creative_id is null
    or p_replacement_draft_id = p_target_creative_id
    or nullif(btrim(p_idempotency_key), '') is null
    or nullif(btrim(p_representative_key), '') is null then
    raise exception 'reviewed replacement identifiers and human actor are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_representative_key, 0));

  select * into v_replacement
  from public.blog_information_replacements as replacement
  where replacement.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replacement.target_creative_id <> p_target_creative_id
      or v_replacement.replacement_draft_id <> p_replacement_draft_id
      or v_replacement.source_fingerprint::text <> p_source_fingerprint::text then
      raise exception 'reviewed replacement idempotency key was reused';
    end if;
    return query select
      v_replacement.target_creative_id,
      v_replacement.replacement_draft_id,
      v_replacement.canonical_slug,
      v_replacement.public_published_at,
      v_replacement.representative_key,
      v_replacement.id,
      v_replacement.indexing_job_id,
      true;
    return;
  end if;

  select * into v_draft
  from public.content_creatives as creative
  where creative.id = p_replacement_draft_id
  for update;
  if not found
    or v_draft.product_id is not null
    or v_draft.channel <> 'naver_blog'
    or v_draft.status <> 'draft'
    or v_draft.review_status <> 'approved' then
    raise exception 'approved private information replacement draft required';
  end if;

  select * into v_target
  from public.content_creatives as creative
  where creative.id = p_target_creative_id
  for update;
  if not found
    or v_target.product_id is not null
    or v_target.channel <> 'naver_blog'
    or v_target.status <> 'published'
    or nullif(btrim(v_target.slug), '') is null then
    raise exception 'published information replacement target required';
  end if;

  v_replacement_contract := coalesce(
    v_draft.generation_meta -> 'reviewed_published_replacement',
    '{}'::jsonb
  );
  if coalesce(v_replacement_contract ->> 'mode', '') <> 'reviewed_published_replacement_v1'
    or coalesce(v_replacement_contract ->> 'target_creative_id', '') <> p_target_creative_id::text
    or coalesce(v_replacement_contract ->> 'canonical_slug', '') <> v_target.slug then
    raise exception 'reviewed replacement contract does not match public target';
  end if;

  select * into v_case
  from public.blog_information_review_cases as review_case
  where review_case.id = p_case_id
    and review_case.creative_id = p_replacement_draft_id
  for update;
  if not found
    or v_case.status <> 'approved'
    or v_case.approved_by is null then
    raise exception 'current human-approved replacement review case required';
  end if;

  v_source_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    coalesce(v_draft.blog_html, ''),
    coalesce(v_draft.seo_title, ''),
    coalesce(v_draft.seo_description, ''),
    coalesce(v_draft.slug, '')
  ), 'sha256'), 'hex');
  if v_source_fingerprint <> p_source_fingerprint::text
    or v_source_fingerprint <> v_case.content_fingerprint::text then
    raise exception 'approved replacement content changed';
  end if;

  v_canonical_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    coalesce(v_draft.blog_html, ''),
    coalesce(v_draft.seo_title, ''),
    coalesce(v_draft.seo_description, ''),
    v_target.slug
  ), 'sha256'), 'hex');
  v_quality_gate := coalesce(p_quality_gate, v_draft.quality_gate, '{}'::jsonb);
  v_claim_validation := coalesce(
    p_validation_meta -> 'information_claim_validation',
    v_draft.generation_meta -> 'information_claim_validation',
    '{}'::jsonb
  );
  if coalesce((v_quality_gate ->> 'passed')::boolean, false) is not true then
    raise exception 'latest replacement quality gate did not pass';
  end if;
  if coalesce((v_claim_validation ->> 'passed')::boolean, false) is not true then
    raise exception 'latest replacement claim validation did not pass';
  end if;

  select * into v_representative
  from public.blog_information_representatives as representative
  where representative.representative_key = p_representative_key
  for update;
  if not found then
    raise exception 'canonical representative does not exist';
  end if;
  v_brief := coalesce(v_draft.generation_meta -> 'content_brief', '{}'::jsonb);
  if v_representative.destination_id <> coalesce(v_brief ->> 'destination_id', '')
    or v_representative.intent <> coalesce(v_brief ->> 'intent_type', '')
    or v_representative.audience <> coalesce(v_brief ->> 'audience', '')
    or v_representative.locale <> coalesce(v_brief ->> 'locale', '') then
    raise exception 'canonical representative identity does not match reviewed replacement';
  end if;
  if v_representative.status = 'active'
    and (
      v_representative.canonical_creative_id <> p_target_creative_id
      or v_representative.canonical_slug <> v_target.slug
    ) then
    raise exception 'active canonical representative does not match replacement target';
  end if;
  if v_representative.status = 'reserved'
    and (
      v_representative.canonical_creative_id is not null
      and v_representative.canonical_creative_id <> p_target_creative_id
    ) then
    raise exception 'reserved canonical representative belongs to another creative';
  end if;
  if v_representative.status = 'reserved'
    and v_representative.reservation_owner <> concat(
      'blog_topic_queue:',
      coalesce(v_replacement_contract ->> 'queue_id', '')
    ) then
    raise exception 'reserved canonical representative belongs to another queue';
  end if;
  if v_representative.status not in ('active', 'reserved') then
    raise exception 'canonical representative is not replaceable';
  end if;

  select count(*) into v_claim_count
  from public.blog_information_claims as claim
  where claim.creative_id = p_replacement_draft_id
    and claim.content_key = v_case.content_key
    and claim.requires_evidence
    and claim.validation_status in ('supported', 'approved');
  if v_claim_count = 0 then
    raise exception 'reviewed replacement has no supported claims';
  end if;
  if exists (
    select 1
    from public.blog_information_claims as claim
    where claim.creative_id = p_replacement_draft_id
      and claim.content_key = v_case.content_key
      and claim.requires_evidence
      and claim.validation_status not in ('supported', 'approved')
  ) then
    raise exception 'reviewed replacement contains an unsupported claim';
  end if;

  select * into v_target_case
  from public.blog_information_review_cases as review_case
  where review_case.creative_id = p_target_creative_id
  for update;

  update public.blog_information_claims
  set content_key = concat(
        v_target.slug,
        '::superseded::',
        p_replacement_draft_id::text
      ),
      creative_id = null,
      validation_reason = 'superseded_by_reviewed_replacement',
      updated_at = v_now
  where content_key = v_target.slug
    and creative_id is distinct from p_replacement_draft_id;

  update public.blog_information_claims
  set content_key = v_target.slug,
      creative_id = p_target_creative_id,
      approved_by = v_case.approved_by,
      approved_at = v_case.approved_at,
      validation_status = 'approved',
      validation_reason = null,
      updated_at = v_now
  where creative_id = p_replacement_draft_id
    and content_key = v_case.content_key;

  update public.blog_information_evidence
  set creative_id = p_target_creative_id,
      updated_at = v_now
  where creative_id = p_replacement_draft_id;

  update public.content_creatives
  set blog_html = v_draft.blog_html,
      seo_title = v_draft.seo_title,
      seo_description = v_draft.seo_description,
      og_image_url = v_draft.og_image_url,
      category = v_draft.category,
      angle_type = v_draft.angle_type,
      content_type = v_draft.content_type,
      topic_source = v_draft.topic_source,
      destination = v_draft.destination,
      quality_gate = v_quality_gate,
      seo_score = v_draft.seo_score,
      readability_score = v_draft.readability_score,
      readability_issues = v_draft.readability_issues,
      landing_enabled = v_draft.landing_enabled,
      target_ad_keywords = v_draft.target_ad_keywords,
      review_status = 'approved',
      status = 'published',
      published_at = coalesce(v_target.published_at, v_now),
      generation_meta = coalesce(v_draft.generation_meta, '{}'::jsonb)
        || coalesce(p_validation_meta, '{}'::jsonb)
        || jsonb_build_object(
          'information_representative', jsonb_build_object(
            'representative_key', p_representative_key,
            'status', 'active',
            'canonical_slug', v_target.slug,
            'decision', 'REVIEWED_REPLACEMENT'
          ),
          'reviewed_published_replacement', v_replacement_contract || jsonb_build_object(
            'status', 'applied',
            'replacement_draft_id', p_replacement_draft_id,
            'review_case_id', p_case_id,
            'canonical_content_fingerprint', v_canonical_fingerprint,
            'applied_at', v_now
          )
        ),
      updated_at = v_now
  where id = p_target_creative_id;

  update public.content_creatives
  set status = 'archived',
      published_at = null,
      generation_meta = coalesce(generation_meta, '{}'::jsonb)
        || jsonb_build_object('reviewed_published_replacement',
          v_replacement_contract || jsonb_build_object(
            'status', 'applied',
            'target_creative_id', p_target_creative_id,
            'canonical_slug', v_target.slug,
            'applied_at', v_now
          )
        ),
      updated_at = v_now
  where id = p_replacement_draft_id;

  update public.blog_information_representatives
  set canonical_creative_id = p_target_creative_id,
      canonical_slug = v_target.slug,
      status = 'active',
      reservation_owner = concat('reviewed-replacement:', p_case_id::text),
      reservation_expires_at = null,
      activated_at = coalesce(activated_at, v_now),
      updated_at = v_now
  where representative_key = p_representative_key;

  insert into public.blog_information_review_cases (
    tenant_id, creative_id, content_key, intent_type, risk_level, status,
    content_fingerprint, validator_report, approved_by, approved_at, updated_at
  ) values (
    v_case.tenant_id, p_target_creative_id, v_target.slug, v_case.intent_type,
    v_case.risk_level, 'approved', v_canonical_fingerprint,
    v_case.validator_report, v_case.approved_by, v_case.approved_at, v_now
  )
  on conflict (creative_id) do update
  set content_key = excluded.content_key,
      intent_type = excluded.intent_type,
      risk_level = excluded.risk_level,
      status = 'approved',
      content_fingerprint = excluded.content_fingerprint,
      validator_report = excluded.validator_report,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at
  returning id into v_target_case_id;

  insert into public.blog_information_review_events (
    review_case_id, creative_id, action, actor_id, from_status, to_status,
    content_fingerprint, validator_report, metadata
  ) values (
    v_target_case_id, p_target_creative_id, 'replacement_applied', p_actor_id,
    v_target_case.status, 'approved', v_canonical_fingerprint,
    v_case.validator_report, jsonb_build_object(
      'replacement_draft_id', p_replacement_draft_id,
      'source_review_case_id', p_case_id
    )
  );

  update public.blog_information_review_cases
  set status = 'published', updated_at = v_now
  where id = p_case_id;

  insert into public.blog_information_review_events (
    review_case_id, creative_id, action, actor_id, from_status, to_status,
    content_fingerprint, validator_report, metadata
  ) values (
    p_case_id, p_replacement_draft_id, 'published', p_actor_id,
    'approved', 'published', v_source_fingerprint,
    v_case.validator_report, jsonb_build_object('applied_to_creative_id', p_target_creative_id)
  );

  update public.content_review_queue
  set status = 'completed'
  where information_review_case_id = p_case_id
    and status in ('queued', 'assigned');

  update public.blog_topic_queue
  set status = 'published',
      content_creative_id = p_target_creative_id,
      last_error = null,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'reviewed_published_replacement', jsonb_build_object(
          'status', 'applied',
          'replacement_draft_id', p_replacement_draft_id,
          'target_creative_id', p_target_creative_id,
          'canonical_slug', v_target.slug,
          'applied_at', v_now
        )
      )
  where id::text = coalesce(v_replacement_contract ->> 'queue_id', '')
    and status = 'pending_review';

  v_url := concat('https://www.yeosonam.com/blog/', v_target.slug);
  insert into public.blog_indexing_jobs (
    content_creative_id, slug, url, source, type, status,
    next_attempt_at, updated_at, idempotency_key
  ) values (
    p_target_creative_id, v_target.slug, v_url, 'information_reviewed_replacement',
    'URL_UPDATED', 'pending', v_now, v_now, p_idempotency_key
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id
    from public.blog_indexing_jobs as indexing_job
    where indexing_job.idempotency_key = p_idempotency_key
      or (
        indexing_job.url = v_url
        and indexing_job.type = 'URL_UPDATED'
        and indexing_job.status in ('pending', 'retry', 'processing')
      )
    order by
      case when indexing_job.idempotency_key = p_idempotency_key then 0 else 1 end,
      indexing_job.created_at desc
    limit 1
    for update;
  end if;
  if v_job_id is null then
    raise exception 'reviewed replacement indexing outbox failed';
  end if;

  insert into public.blog_information_replacements (
    idempotency_key, target_creative_id, replacement_draft_id, review_case_id,
    representative_key, source_fingerprint, canonical_fingerprint,
    canonical_slug, indexing_job_id, actor_id, public_published_at, previous_snapshot,
    replacement_snapshot, replaced_at
  ) values (
    p_idempotency_key, p_target_creative_id, p_replacement_draft_id, p_case_id,
    p_representative_key, v_source_fingerprint, v_canonical_fingerprint,
    v_target.slug, v_job_id, p_actor_id, coalesce(v_target.published_at, v_now),
    jsonb_build_object(
      'blog_html', v_target.blog_html,
      'seo_title', v_target.seo_title,
      'seo_description', v_target.seo_description,
      'og_image_url', v_target.og_image_url,
      'quality_gate', v_target.quality_gate,
      'seo_score', v_target.seo_score,
      'generation_meta', v_target.generation_meta,
      'review_status', v_target.review_status,
      'published_at', v_target.published_at
    ),
    jsonb_build_object(
      'blog_html', v_draft.blog_html,
      'seo_title', v_draft.seo_title,
      'seo_description', v_draft.seo_description,
      'og_image_url', v_draft.og_image_url,
      'quality_gate', v_quality_gate,
      'seo_score', v_draft.seo_score,
      'generation_meta', v_draft.generation_meta,
      'source_fingerprint', v_source_fingerprint,
      'canonical_fingerprint', v_canonical_fingerprint
    ),
    v_now
  )
  returning * into v_replacement;

  return query select
    v_replacement.target_creative_id,
    v_replacement.replacement_draft_id,
    v_replacement.canonical_slug,
    coalesce(v_target.published_at, v_now),
    v_replacement.representative_key,
    v_replacement.id,
    v_replacement.indexing_job_id,
    false;
end;
$$;

revoke all on function public.replace_blog_information_reviewed_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.replace_blog_information_reviewed_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) to service_role;

comment on table public.blog_information_replacements is
  'Append-only audit ledger for human-approved in-place informational blog replacements.';
comment on function public.replace_blog_information_reviewed_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) is
  'Atomically applies an approved private replacement while preserving the public creative ID, slug, and original publish date.';

commit;
