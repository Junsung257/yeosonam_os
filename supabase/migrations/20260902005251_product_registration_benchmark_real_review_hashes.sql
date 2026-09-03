-- Benchmark execution must carry the actual human-review receipts. A constant
-- placeholder can make an application-layer double-review check meaningless.
alter table internal_product_registration.benchmark_annotation_reviews
  add column if not exists actor_kind text not null default 'unverified'
    check (actor_kind in ('unverified', 'authenticated_account', 'human')),
  add column if not exists actor_assurance text not null default 'unverified'
    check (actor_assurance in ('unverified', 'authenticated_session', 'webauthn_user_presence', 'external_signed')),
  add column if not exists authenticated_subject uuid,
  add column if not exists review_session_id uuid;

create table if not exists internal_product_registration.benchmark_human_review_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  corpus_source_id uuid not null references internal_product_registration.benchmark_corpus_sources(id) on delete restrict,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  reviewer_slot text not null check (reviewer_slot in ('first', 'second', 'adjudicator')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'benchmark_annotation_reviews_actor_consistency'
      and conrelid = 'internal_product_registration.benchmark_annotation_reviews'::regclass
  ) then
    alter table internal_product_registration.benchmark_annotation_reviews
      add constraint benchmark_annotation_reviews_actor_consistency check (
        (actor_kind = 'unverified' and actor_assurance = 'unverified'
          and authenticated_subject is null and review_session_id is null)
        or
        (actor_kind = 'authenticated_account' and actor_assurance = 'authenticated_session'
          and authenticated_subject is not null and review_session_id is not null)
        or
        (actor_kind = 'human' and actor_assurance in ('webauthn_user_presence', 'external_signed')
          and authenticated_subject is not null and review_session_id is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'benchmark_annotation_reviews_session_fk'
      and conrelid = 'internal_product_registration.benchmark_annotation_reviews'::regclass
  ) then
    alter table internal_product_registration.benchmark_annotation_reviews
      add constraint benchmark_annotation_reviews_session_fk
      foreign key (review_session_id)
      references internal_product_registration.benchmark_human_review_sessions(id) on delete restrict;
  end if;
end;
$$;

alter table internal_product_registration.benchmark_human_review_sessions enable row level security;
alter table internal_product_registration.benchmark_human_review_sessions force row level security;
revoke all on table internal_product_registration.benchmark_human_review_sessions from public, anon, authenticated;
grant all on table internal_product_registration.benchmark_human_review_sessions to service_role;

create or replace function public.begin_product_registration_benchmark_human_review_session(
  p_tenant_id uuid,
  p_corpus_source_id uuid,
  p_reviewer_slot text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_source_hash text;
  v_expected_slot text;
begin
  if v_actor is null then raise exception 'BENCHMARK_AUTHENTICATED_REVIEWER_REQUIRED'; end if;
  if p_reviewer_slot not in ('first', 'second', 'adjudicator') then
    raise exception 'BENCHMARK_REVIEW_SLOT_INVALID';
  end if;
  if not exists (
    select 1 from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = v_actor
      and m.is_active
      and m.role in ('tenant_admin', 'tenant_staff')
      and t.status = 'active'
  ) then raise exception 'BENCHMARK_REVIEWER_MEMBERSHIP_REQUIRED'; end if;

  select c.source_hash,
    case
      when not exists (select 1 from internal_product_registration.benchmark_annotation_reviews r where r.corpus_source_id = c.id and r.reviewer_slot = 'first') then 'first'
      when not exists (select 1 from internal_product_registration.benchmark_annotation_reviews r where r.corpus_source_id = c.id and r.reviewer_slot = 'second') then 'second'
      else 'adjudicator'
    end
  into v_source_hash, v_expected_slot
  from internal_product_registration.benchmark_corpus_sources c
  where c.id = p_corpus_source_id
    and c.tenant_id = p_tenant_id
    and c.eligibility_state in ('candidate', 'annotating')
    and not exists (
      select 1 from internal_product_registration.benchmark_annotation_reviews own
      where own.corpus_source_id = c.id and own.reviewer_id = v_actor
    );
  if v_source_hash is null then raise exception 'BENCHMARK_CORPUS_SOURCE_NOT_REVIEWABLE'; end if;
  if v_expected_slot <> p_reviewer_slot then raise exception 'BENCHMARK_REVIEW_SLOT_STALE'; end if;

  select s.id into v_session_id
  from internal_product_registration.benchmark_human_review_sessions s
  where s.tenant_id = p_tenant_id
    and s.user_id = v_actor
    and s.corpus_source_id = p_corpus_source_id
    and s.source_hash = v_source_hash
    and s.reviewer_slot = p_reviewer_slot
    and s.consumed_at is null
    and s.expires_at > now()
  order by s.created_at desc
  limit 1;
  if v_session_id is not null then return v_session_id; end if;

  insert into internal_product_registration.benchmark_human_review_sessions (
    tenant_id, user_id, corpus_source_id, source_hash, reviewer_slot, expires_at
  ) values (p_tenant_id, v_actor, p_corpus_source_id, v_source_hash, p_reviewer_slot, now() + interval '10 minutes')
  returning id into v_session_id;
  return v_session_id;
end;
$$;

create or replace function internal_product_registration.attest_benchmark_human_review()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_session_id uuid;
  v_actor uuid;
begin
  -- Never trust actor fields supplied by a service-role INSERT. Only the
  -- authenticated wrapper can attach a verified session to this immutable row.
  new.actor_kind := 'unverified';
  new.actor_assurance := 'unverified';
  new.authenticated_subject := null;
  new.review_session_id := null;
  begin
    v_session_id := nullif(current_setting('app.benchmark_review_session_id', true), '')::uuid;
    v_actor := nullif(current_setting('app.benchmark_review_actor_id', true), '')::uuid;
  exception when others then
    return new;
  end;
  if v_session_id is null or v_actor is null then return new; end if;
  if exists (
    select 1
    from internal_product_registration.benchmark_human_review_sessions s
    where s.id = v_session_id
      and s.tenant_id = new.tenant_id
      and s.user_id = v_actor
      and s.corpus_source_id = new.corpus_source_id
      and s.source_hash = (
        select c.source_hash from internal_product_registration.benchmark_corpus_sources c
        where c.id = new.corpus_source_id and c.tenant_id = new.tenant_id
      )
      and s.reviewer_slot = new.reviewer_slot
      and s.consumed_at is not null
      and s.expires_at > now()
      and new.reviewer_id = v_actor
      and new.blinded_to_engine
  ) then
    new.actor_kind := 'authenticated_account';
    new.actor_assurance := 'authenticated_session';
    new.authenticated_subject := v_actor;
    new.review_session_id := v_session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pr_benchmark_human_review_attestation
  on internal_product_registration.benchmark_annotation_reviews;
create trigger trg_pr_benchmark_human_review_attestation
before insert on internal_product_registration.benchmark_annotation_reviews
for each row execute function internal_product_registration.attest_benchmark_human_review();

create or replace function public.submit_product_registration_benchmark_human_review_authenticated(
  p_tenant_id uuid,
  p_corpus_source_id uuid,
  p_review_session_id uuid,
  p_reviewer_slot text,
  p_annotation jsonb,
  p_annotation_hash text,
  p_evidence_anchors jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'BENCHMARK_AUTHENTICATED_REVIEWER_REQUIRED'; end if;
  update internal_product_registration.benchmark_human_review_sessions s
  set consumed_at = now()
  where s.id = p_review_session_id
    and s.tenant_id = p_tenant_id
    and s.user_id = v_actor
    and s.corpus_source_id = p_corpus_source_id
    and s.reviewer_slot = p_reviewer_slot
    and s.source_hash = (
      select c.source_hash from internal_product_registration.benchmark_corpus_sources c
      where c.id = p_corpus_source_id and c.tenant_id = p_tenant_id
    )
    and s.consumed_at is null
    and s.expires_at > now();
  if not found then raise exception 'BENCHMARK_HUMAN_REVIEW_SESSION_INVALID'; end if;

  perform set_config('app.benchmark_review_session_id', p_review_session_id::text, true);
  perform set_config('app.benchmark_review_actor_id', v_actor::text, true);
  v_result := public.submit_product_registration_benchmark_review_atomic(
    p_tenant_id,
    p_corpus_source_id,
    v_actor,
    p_reviewer_slot,
    p_annotation,
    p_annotation_hash,
    p_evidence_anchors
  );
  return v_result;
end;
$$;

create or replace function public.get_product_registration_benchmark_run_cases_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'corpusSourceId', c.id,
    'sourceDocumentId', c.source_document_id,
    'sourceHash', c.source_hash,
    'lineageHash', c.lineage_hash,
    'inputKind', c.input_kind,
    'split', c.split,
    'supplierKey', c.supplier_key,
    'documentFamily', c.document_family,
    'sourceDepartureYear', c.metadata->'sourceDepartureYear',
    'originalFilename', d.original_filename,
    'storageBucket', d.storage_bucket,
    'storagePath', d.storage_path,
    'sourceType', d.source_type,
    'expectedDocumentClass', c.source_class,
    'groundTruthSections', (
      select jsonb_agg(jsonb_build_object(
        'groundTruthSectionId', g.id,
        'sectionIndex', g.section_index,
        'groundTruth', g.ground_truth,
        'reviewState', g.review_state,
        'firstReviewHash', g.first_review_hash,
        'secondReviewHash', g.second_review_hash,
        'adjudicationHash', g.adjudication_hash,
        'humanReviewActorAssured', (
          select case when g.review_state = 'double_verified' then
            count(*) filter (where r.reviewer_slot in ('first', 'second')) = 2
            and count(distinct r.reviewer_id) filter (where r.reviewer_slot in ('first', 'second')) = 2
            and bool_and(
              r.actor_kind = 'human'
              and r.actor_assurance in ('webauthn_user_presence', 'external_signed')
              and r.authenticated_subject = r.reviewer_id
              and r.review_session_id is not null
              and s.user_id = r.reviewer_id
              and s.tenant_id = r.tenant_id
              and s.corpus_source_id = r.corpus_source_id
              and s.source_hash = c.source_hash
              and s.reviewer_slot = r.reviewer_slot
              and s.consumed_at is not null
              and r.blinded_to_engine
            ) filter (where r.reviewer_slot in ('first', 'second'))
          else
            count(*) filter (where r.reviewer_slot in ('first', 'second', 'adjudicator')) = 3
            and count(distinct r.reviewer_id) filter (where r.reviewer_slot in ('first', 'second', 'adjudicator')) = 3
            and bool_and(
              r.actor_kind = 'human'
              and r.actor_assurance in ('webauthn_user_presence', 'external_signed')
              and r.authenticated_subject = r.reviewer_id
              and r.review_session_id is not null
              and s.user_id = r.reviewer_id
              and s.tenant_id = r.tenant_id
              and s.corpus_source_id = r.corpus_source_id
              and s.source_hash = c.source_hash
              and s.reviewer_slot = r.reviewer_slot
              and s.consumed_at is not null
              and r.blinded_to_engine
            ) filter (where r.reviewer_slot in ('first', 'second', 'adjudicator'))
          end
          from internal_product_registration.benchmark_annotation_reviews r
          left join internal_product_registration.benchmark_human_review_sessions s
            on s.id = r.review_session_id
          where r.corpus_source_id = c.id
        ),
        'reviewerIds', (
          select coalesce(jsonb_agg(r.reviewer_id order by r.reviewer_slot), '[]'::jsonb)
          from internal_product_registration.benchmark_annotation_reviews r
          where r.corpus_source_id = c.id
            and r.reviewer_slot in ('first', 'second', 'adjudicator')
        )
      ) order by g.section_index)
      from internal_product_registration.benchmark_ground_truth_sections g
      where g.corpus_source_id = c.id
        and g.tenant_id = c.tenant_id
        and g.review_state in ('double_verified', 'adjudicated')
        and g.first_review_hash ~ '^[0-9a-f]{64}$'
        and g.second_review_hash ~ '^[0-9a-f]{64}$'
        and (
          (g.review_state = 'double_verified'
            and g.first_review_hash = g.second_review_hash
            and g.adjudication_hash is null)
          or
          (g.review_state = 'adjudicated'
            and g.first_review_hash <> g.second_review_hash
            and g.adjudication_hash ~ '^[0-9a-f]{64}$')
        )
    )
  ) order by c.id), '[]'::jsonb)
  from internal_product_registration.profile_benchmark_runs r
  join internal_product_registration.benchmark_corpus_sources c
    on c.tenant_id = r.tenant_id
    and c.corpus_version = r.corpus_version
    and c.eligibility_state = 'eligible'
    and c.split = 'frozen'
    and c.annotation_schema_version = 'product-registration-reviewed-benchmark-2'
    and (coalesce(r.input_kind, 'combined') = 'combined' or c.input_kind = r.input_kind)
  join public.product_source_documents d
    on d.id = c.source_document_id
    and d.tenant_id = c.tenant_id
  where r.id = p_benchmark_run_id
    and r.tenant_id = p_tenant_id
    and r.run_scope = 'global';
$$;

-- Existing accepted corpus rows keep their immutable audit history. Rows whose
-- old reviews cannot satisfy the new actor proof are copied into a new corpus
-- version and return to the normal blind queue instead of being deleted or
-- silently grandfathered.
create or replace function public.create_product_registration_benchmark_reverification_epoch(
  p_tenant_id uuid,
  p_from_corpus_version text,
  p_to_corpus_version text
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inserted integer;
begin
  if nullif(btrim(p_from_corpus_version), '') is null
    or nullif(btrim(p_to_corpus_version), '') is null
    or p_from_corpus_version = p_to_corpus_version then
    raise exception 'BENCHMARK_REVERIFICATION_VERSION_INVALID';
  end if;
  insert into internal_product_registration.benchmark_corpus_sources (
    tenant_id, source_document_id, corpus_version, source_hash, lineage_hash,
    normalized_text_hash, input_kind, split, supplier_key, document_family,
    source_class, eligibility_state, fingerprint, metadata, reference_date,
    annotation_schema_version
  )
  select c.tenant_id, c.source_document_id, p_to_corpus_version, c.source_hash,
    c.lineage_hash, c.normalized_text_hash, c.input_kind, c.split,
    c.supplier_key, c.document_family, c.source_class, 'candidate', c.fingerprint,
    c.metadata || jsonb_build_object(
      'reverificationOfCorpusSourceId', c.id,
      'reverificationReason', 'actor_assurance_upgrade'
    ),
    c.reference_date, 'product-registration-reviewed-benchmark-2'
  from internal_product_registration.benchmark_corpus_sources c
  where c.tenant_id = p_tenant_id
    and c.corpus_version = p_from_corpus_version
    and c.eligibility_state = 'eligible'
    and exists (
      select 1
      from internal_product_registration.benchmark_annotation_reviews r
      where r.corpus_source_id = c.id
        and not (
          r.actor_kind = 'human'
          and r.actor_assurance in ('webauthn_user_presence', 'external_signed')
          and r.authenticated_subject = r.reviewer_id
          and r.review_session_id is not null
        )
    )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.get_product_registration_benchmark_run_cases_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_run_cases_v2(uuid, uuid)
  to service_role;
revoke all on function public.create_product_registration_benchmark_reverification_epoch(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_product_registration_benchmark_reverification_epoch(uuid, text, text)
  to service_role;

revoke all on function public.begin_product_registration_benchmark_human_review_session(uuid, uuid, text)
  from public, anon;
grant execute on function public.begin_product_registration_benchmark_human_review_session(uuid, uuid, text)
  to authenticated;
revoke all on function public.submit_product_registration_benchmark_human_review_authenticated(uuid, uuid, uuid, text, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.submit_product_registration_benchmark_human_review_authenticated(uuid, uuid, uuid, text, jsonb, text, jsonb)
  to authenticated;
revoke all on function internal_product_registration.attest_benchmark_human_review()
  from public, anon, authenticated;

comment on function public.get_product_registration_benchmark_run_cases_v2(uuid, uuid) is
  'Service-role benchmark reader returning immutable sources plus persisted annotation hashes; actor assurance remains a separate release gate and AI panel output is excluded.';
