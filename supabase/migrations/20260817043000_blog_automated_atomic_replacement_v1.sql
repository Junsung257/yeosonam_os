-- DeepSeek V4 LOW/MEDIUM representative refresh.
-- A generated shadow draft can replace an existing canonical row only when the
-- durable selected attempt and every publication contract still pass inside
-- this transaction. HIGH-risk content remains on the human-reviewed function.

begin;

create table if not exists public.blog_information_automated_replacements (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  target_creative_id uuid not null references public.content_creatives(id) on delete restrict,
  replacement_draft_id uuid not null references public.content_creatives(id) on delete restrict,
  run_id uuid not null references public.blog_generation_runs(id) on delete restrict,
  selected_attempt_id uuid not null references public.blog_generation_attempts(id) on delete restrict,
  representative_key text not null references public.blog_information_representatives(representative_key) on delete restrict,
  source_fingerprint char(64) not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_fingerprint char(64) not null check (canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_slug text not null check (btrim(canonical_slug) <> ''),
  indexing_job_id uuid not null references public.blog_indexing_jobs(id) on delete restrict,
  public_published_at timestamptz not null,
  previous_snapshot jsonb not null,
  replacement_snapshot jsonb not null,
  replaced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id),
  unique (replacement_draft_id, source_fingerprint)
);

create index if not exists idx_blog_information_automated_replacements_target
  on public.blog_information_automated_replacements (target_creative_id, replaced_at desc);
create index if not exists idx_blog_information_automated_replacements_representative
  on public.blog_information_automated_replacements (representative_key, replaced_at desc);
create index if not exists idx_blog_information_automated_replacements_attempt
  on public.blog_information_automated_replacements (selected_attempt_id);
create index if not exists idx_blog_information_automated_replacements_indexing_job
  on public.blog_information_automated_replacements (indexing_job_id);

alter table public.blog_information_automated_replacements enable row level security;
revoke all on table public.blog_information_automated_replacements from public, anon, authenticated;
grant select, insert on table public.blog_information_automated_replacements to service_role;

drop policy if exists blog_information_automated_replacements_service_role
  on public.blog_information_automated_replacements;
create policy blog_information_automated_replacements_service_role
  on public.blog_information_automated_replacements
  for all to service_role using (true) with check (true);

create or replace function public.replace_blog_information_automated_draft_atomically(
  p_replacement_draft_id uuid,
  p_target_creative_id uuid,
  p_run_id uuid,
  p_selected_attempt_id uuid,
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
  v_run public.blog_generation_runs%rowtype;
  v_attempt public.blog_generation_attempts%rowtype;
  v_representative public.blog_information_representatives%rowtype;
  v_replacement public.blog_information_automated_replacements%rowtype;
  v_contract jsonb;
  v_orchestration jsonb;
  v_autopublish jsonb;
  v_brief jsonb;
  v_quality_gate jsonb;
  v_claim_validation jsonb;
  v_source_fingerprint text;
  v_canonical_fingerprint text;
  v_claim_count integer := 0;
  v_job_id uuid;
  v_url text;
  v_now timestamptz := now();
begin
  if p_replacement_draft_id is null
    or p_target_creative_id is null
    or p_run_id is null
    or p_selected_attempt_id is null
    or p_replacement_draft_id = p_target_creative_id
    or nullif(btrim(p_representative_key), '') is null
    or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'automated replacement identifiers are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_representative_key, 0));

  select * into v_replacement
  from public.blog_information_automated_replacements as replacement
  where replacement.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replacement.target_creative_id <> p_target_creative_id
      or v_replacement.replacement_draft_id <> p_replacement_draft_id
      or v_replacement.run_id <> p_run_id
      or v_replacement.selected_attempt_id <> p_selected_attempt_id
      or v_replacement.source_fingerprint::text <> p_source_fingerprint::text then
      raise exception 'automated replacement idempotency key was reused';
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
    or coalesce(v_draft.review_status, 'none') not in ('none', '') then
    raise exception 'private low-risk automated replacement draft required';
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

  v_contract := coalesce(v_draft.generation_meta -> 'automated_published_replacement', '{}'::jsonb);
  if coalesce(v_contract ->> 'mode', '') <> 'automated_published_replacement_v1'
    or coalesce(v_contract ->> 'status', '') <> 'approved_for_slot'
    or coalesce(v_contract ->> 'target_creative_id', '') <> p_target_creative_id::text
    or coalesce(v_contract ->> 'canonical_slug', '') <> v_target.slug
    or coalesce(v_contract ->> 'draft_slug', '') <> v_draft.slug
    or coalesce(v_contract ->> 'queue_id', '') = '' then
    raise exception 'automated replacement contract does not match public target';
  end if;

  select * into v_run
  from public.blog_generation_runs as generation_run
  where generation_run.id = p_run_id
  for update;
  if not found
    or v_run.queue_id::text <> coalesce(v_contract ->> 'queue_id', '')
    or v_run.content_creative_id <> p_replacement_draft_id
    or v_run.selected_attempt_id <> p_selected_attempt_id
    or v_run.status <> 'publishing'
    or coalesce(v_run.latest_quality_score, 0) < 90 then
    raise exception 'current approved generation run required';
  end if;

  select * into v_attempt
  from public.blog_generation_attempts as attempt
  where attempt.id = p_selected_attempt_id
    and attempt.run_id = p_run_id
  for share;
  if not found
    or v_attempt.status <> 'completed'
    or v_attempt.provider <> 'deepseek'
    or v_attempt.route <> 'approved_for_slot'
    or coalesce(v_attempt.finish_reason, '') <> 'stop'
    or coalesce(v_attempt.quality_score_after, 0) < 90
    or jsonb_array_length(coalesce(v_attempt.hard_blockers, '[]'::jsonb)) <> 0
    or jsonb_array_length(coalesce(v_attempt.failure_reasons, '[]'::jsonb)) <> 0
    or coalesce(v_attempt.output_document ->> 'title', '') <> coalesce(v_draft.seo_title, '')
    or coalesce(v_attempt.output_document ->> 'description', '') <> coalesce(v_draft.seo_description, '')
    or coalesce(v_attempt.output_document ->> 'markdown', '') <> coalesce(v_draft.blog_html, '')
    or coalesce(v_attempt.output_document ->> 'slug', '') <> v_target.slug then
    raise exception 'selected DeepSeek attempt is not an exact publishable replacement';
  end if;

  v_orchestration := coalesce(v_draft.generation_meta -> 'ai_orchestration_v4', '{}'::jsonb);
  v_autopublish := coalesce(v_draft.generation_meta -> 'autopublish_policy_v3', '{}'::jsonb);
  v_brief := coalesce(v_draft.generation_meta -> 'content_brief', '{}'::jsonb);
  if coalesce(v_orchestration ->> 'version', '') <> 'blog-deepseek-orchestrator-v4'
    or coalesce(v_orchestration ->> 'route', '') <> 'approved_for_slot'
    or coalesce((v_orchestration ->> 'score')::numeric, 0) < 90
    or coalesce((v_orchestration ->> 'publish_quality_passed')::boolean, false) is not true
    or coalesce(v_autopublish ->> 'mode', '') <> 'live'
    or coalesce((v_autopublish ->> 'publish')::boolean, false) is not true
    or coalesce((v_autopublish -> 'score' ->> 'eligible')::boolean, false) is not true then
    raise exception 'automated publication policy is not currently satisfied';
  end if;
  if coalesce(v_brief ->> 'risk_level', 'HIGH') not in ('LOW', 'MEDIUM')
    or coalesce((v_brief ->> 'requires_human_review')::boolean, false) is true then
    raise exception 'HIGH-risk or human-review content cannot use automated replacement';
  end if;

  v_source_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    coalesce(v_draft.blog_html, ''),
    coalesce(v_draft.seo_title, ''),
    coalesce(v_draft.seo_description, ''),
    coalesce(v_draft.slug, '')
  ), 'sha256'), 'hex');
  if v_source_fingerprint <> p_source_fingerprint::text then
    raise exception 'automated replacement content changed';
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
    raise exception 'latest automated replacement quality gate did not pass';
  end if;
  if coalesce((v_claim_validation ->> 'passed')::boolean, false) is not true
    or coalesce((v_claim_validation ->> 'coverage')::numeric, 0) <> 1
    or coalesce((v_claim_validation ->> 'claim_count')::integer, 0) <= 0
    or jsonb_array_length(coalesce(v_claim_validation -> 'issues', '[]'::jsonb)) <> 0 then
    raise exception 'latest automated replacement claim validation did not pass';
  end if;

  select * into v_representative
  from public.blog_information_representatives as representative
  where representative.representative_key = p_representative_key
  for update;
  if not found
    or v_representative.status <> 'active'
    or v_representative.canonical_creative_id <> p_target_creative_id
    or v_representative.canonical_slug <> v_target.slug
    or v_representative.destination_id <> coalesce(v_brief ->> 'destination_id', '')
    or v_representative.intent <> coalesce(v_brief ->> 'intent_type', '')
    or v_representative.audience <> coalesce(v_brief ->> 'audience', '')
    or v_representative.locale <> coalesce(v_brief ->> 'locale', '') then
    raise exception 'active canonical representative does not match automated replacement';
  end if;

  select count(*) into v_claim_count
  from public.blog_information_claims as claim
  where claim.creative_id = p_replacement_draft_id
    and claim.content_key = v_draft.slug
    and claim.requires_evidence
    and claim.risk_level in ('LOW', 'MEDIUM')
    and claim.validation_status = 'supported';
  if v_claim_count = 0 then
    raise exception 'automated replacement has no supported LOW/MEDIUM claims';
  end if;
  if exists (
    select 1
    from public.blog_information_claims as claim
    where claim.creative_id = p_replacement_draft_id
      and claim.content_key = v_draft.slug
      and claim.requires_evidence
      and (claim.risk_level = 'HIGH' or claim.validation_status <> 'supported')
  ) then
    raise exception 'automated replacement contains blocked claims';
  end if;

  update public.blog_information_claims
  set content_key = concat(v_target.slug, '::superseded::', p_run_id::text),
      creative_id = null,
      validation_reason = 'superseded_by_automated_replacement',
      updated_at = v_now
  where content_key = v_target.slug
    and creative_id is distinct from p_replacement_draft_id;

  update public.blog_information_claims
  set content_key = v_target.slug,
      creative_id = p_target_creative_id,
      approved_by = null,
      approved_at = null,
      validation_status = 'supported',
      validation_reason = null,
      updated_at = v_now
  where creative_id = p_replacement_draft_id
    and content_key = v_draft.slug;

  update public.blog_information_evidence
  set creative_id = p_target_creative_id,
      updated_at = v_now
  where creative_id = p_replacement_draft_id;

  update public.content_creatives
  set blog_html = v_draft.blog_html,
      title = v_draft.title,
      description = v_draft.description,
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
      review_status = v_draft.review_status,
      status = 'published',
      published_at = coalesce(v_target.published_at, v_now),
      generation_meta = coalesce(v_draft.generation_meta, '{}'::jsonb)
        || coalesce(p_validation_meta, '{}'::jsonb)
        || jsonb_build_object(
          'information_representative', jsonb_build_object(
            'representative_key', p_representative_key,
            'status', 'active',
            'canonical_slug', v_target.slug,
            'decision', 'AUTOMATED_REPLACEMENT'
          ),
          'automated_published_replacement', v_contract || jsonb_build_object(
            'status', 'applied',
            'replacement_draft_id', p_replacement_draft_id,
            'run_id', p_run_id,
            'selected_attempt_id', p_selected_attempt_id,
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
        || jsonb_build_object(
          'automated_published_replacement',
          v_contract || jsonb_build_object(
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
      reservation_owner = concat('automated-replacement:', p_run_id::text),
      reservation_expires_at = null,
      activated_at = coalesce(activated_at, v_now),
      updated_at = v_now
  where representative_key = p_representative_key;

  update public.blog_topic_queue
  set status = 'published',
      content_creative_id = p_target_creative_id,
      last_error = null,
      attempts = 0,
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'automated_published_replacement',
        v_contract || jsonb_build_object(
          'status', 'applied',
          'replacement_draft_id', p_replacement_draft_id,
          'target_creative_id', p_target_creative_id,
          'canonical_slug', v_target.slug,
          'applied_at', v_now
        )
      )
  where id = v_run.queue_id;

  update public.blog_generation_runs
  set status = 'published',
      disposition = 'published_automated_replacement',
      content_creative_id = p_target_creative_id,
      published_at = v_now,
      last_error = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = v_now
  where id = p_run_id
    and status = 'publishing';

  v_url := concat('https://www.yeosonam.com/blog/', v_target.slug);
  insert into public.blog_indexing_jobs (
    content_creative_id, slug, url, source, type, status,
    next_attempt_at, updated_at, idempotency_key
  ) values (
    p_target_creative_id, v_target.slug, v_url, 'information_automated_replacement',
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
    raise exception 'automated replacement indexing outbox failed';
  end if;

  insert into public.blog_information_automated_replacements (
    idempotency_key, target_creative_id, replacement_draft_id, run_id,
    selected_attempt_id, representative_key, source_fingerprint,
    canonical_fingerprint, canonical_slug, indexing_job_id,
    public_published_at, previous_snapshot, replacement_snapshot, replaced_at
  ) values (
    p_idempotency_key, p_target_creative_id, p_replacement_draft_id, p_run_id,
    p_selected_attempt_id, p_representative_key, v_source_fingerprint,
    v_canonical_fingerprint, v_target.slug, v_job_id,
    coalesce(v_target.published_at, v_now),
    jsonb_build_object(
      'blog_html', v_target.blog_html,
      'title', v_target.title,
      'description', v_target.description,
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
      'title', v_draft.title,
      'description', v_draft.description,
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

revoke all on function public.replace_blog_information_automated_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.replace_blog_information_automated_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) to service_role;

comment on table public.blog_information_automated_replacements is
  'Append-only audit ledger for DeepSeek V4 LOW/MEDIUM in-place representative refreshes.';
comment on function public.replace_blog_information_automated_draft_atomically(
  uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
) is
  'Fail-closed atomic replacement requiring the exact selected DeepSeek attempt, gates, demand, evidence, and active canonical representative.';

-- Dry-run/backfill: intentionally none. Historical drafts are not upgraded into
-- this contract. Only a newly generated V4 approved_for_slot run may call it.
--
-- Rollback (manual, after application rollback and only when no call is active):
-- drop function if exists public.replace_blog_information_automated_draft_atomically(
--   uuid, uuid, uuid, uuid, char, jsonb, jsonb, text, text
-- );
-- drop table if exists public.blog_information_automated_replacements;

commit;
