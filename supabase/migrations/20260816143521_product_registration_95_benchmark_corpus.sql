-- Private, source-backed benchmark ledger for the HWP + pasted-text 95% gate.
-- This migration is forward-only and does not change authority mode, publication
-- freeze, public pointers, or customer-visible package state.

create table if not exists internal_product_registration.benchmark_corpus_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  corpus_version text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  lineage_hash text not null check (lineage_hash ~ '^[0-9a-f]{64}$'),
  normalized_text_hash text check (normalized_text_hash is null or normalized_text_hash ~ '^[0-9a-f]{64}$'),
  input_kind text not null check (input_kind in ('hwp', 'text')),
  split text not null check (split in ('development', 'calibration', 'frozen')),
  supplier_key text,
  document_family text,
  source_class text not null default 'travel_product'
    check (source_class in ('travel_product', 'non_travel', 'unsupported', 'corrupt')),
  eligibility_state text not null default 'candidate'
    check (eligibility_state in ('candidate', 'annotating', 'eligible', 'excluded', 'retired')),
  fingerprint jsonb not null default '{}'::jsonb check (jsonb_typeof(fingerprint) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, corpus_version, source_document_id),
  unique (tenant_id, corpus_version, source_hash, input_kind)
);

create table if not exists internal_product_registration.benchmark_ground_truth_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  corpus_source_id uuid not null references internal_product_registration.benchmark_corpus_sources(id) on delete restrict,
  section_index integer not null check (section_index >= 0),
  boundary_start integer check (boundary_start is null or boundary_start >= 0),
  boundary_end integer check (boundary_end is null or boundary_end >= 0),
  annotation_schema_version text not null,
  ground_truth jsonb not null default '{}'::jsonb check (jsonb_typeof(ground_truth) = 'object'),
  evidence_anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_anchors) = 'array'),
  review_state text not null default 'draft'
    check (review_state in ('draft', 'first_verified', 'double_verified', 'conflict', 'adjudicated', 'retired')),
  first_review_hash text check (first_review_hash is null or first_review_hash ~ '^[0-9a-f]{64}$'),
  second_review_hash text check (second_review_hash is null or second_review_hash ~ '^[0-9a-f]{64}$'),
  adjudication_hash text check (adjudication_hash is null or adjudication_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corpus_source_id, section_index),
  check (boundary_start is null or boundary_end is null or boundary_start < boundary_end),
  check (
    split_part(review_state, '_', 1) <> 'double'
    or (first_review_hash is not null and second_review_hash is not null and first_review_hash = second_review_hash)
  )
);

create table if not exists internal_product_registration.benchmark_annotation_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ground_truth_section_id uuid not null references internal_product_registration.benchmark_ground_truth_sections(id) on delete restrict,
  reviewer_slot text not null check (reviewer_slot in ('first', 'second', 'adjudicator')),
  annotation_hash text not null check (annotation_hash ~ '^[0-9a-f]{64}$'),
  annotation jsonb not null check (jsonb_typeof(annotation) = 'object'),
  evidence_anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_anchors) = 'array'),
  blinded_to_engine boolean not null default true,
  reviewer_id uuid,
  created_at timestamptz not null default now(),
  unique (ground_truth_section_id, reviewer_slot, annotation_hash)
);

alter table internal_product_registration.profile_benchmark_runs
  add column if not exists input_kind text,
  add column if not exists frozen_holdout boolean not null default false,
  add column if not exists sample_count integer not null default 0,
  add column if not exists safe_open_count integer not null default 0,
  add column if not exists safe_open_rate numeric(7,6),
  add column if not exists wilson_lower_bound numeric(7,6),
  add column if not exists segment_exact_match_rate numeric(7,6),
  add column if not exists extraction_success_rate numeric(7,6),
  add column if not exists parser_fallback_rate numeric(7,6),
  add column if not exists parser_disagreement_rate numeric(7,6),
  add column if not exists operational_paste_section_count integer not null default 0,
  add column if not exists hwp_paste_comparable_lineage_count integer not null default 0,
  add column if not exists hwp_paste_parity_rate numeric(7,6);

create unique index if not exists idx_pr_profile_benchmark_runs_tenant_id_id
  on internal_product_registration.profile_benchmark_runs(tenant_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profile_benchmark_runs_input_kind_check'
      and conrelid = 'internal_product_registration.profile_benchmark_runs'::regclass
  ) then
    alter table internal_product_registration.profile_benchmark_runs
      add constraint profile_benchmark_runs_input_kind_check
      check (input_kind is null or input_kind in ('hwp', 'text', 'combined'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profile_benchmark_runs_rate_check'
      and conrelid = 'internal_product_registration.profile_benchmark_runs'::regclass
  ) then
    alter table internal_product_registration.profile_benchmark_runs
      add constraint profile_benchmark_runs_rate_check check (
        sample_count >= 0 and safe_open_count >= 0 and safe_open_count <= sample_count
        and (safe_open_rate is null or safe_open_rate between 0 and 1)
        and (wilson_lower_bound is null or wilson_lower_bound between 0 and 1)
        and (segment_exact_match_rate is null or segment_exact_match_rate between 0 and 1)
        and (extraction_success_rate is null or extraction_success_rate between 0 and 1)
        and (parser_fallback_rate is null or parser_fallback_rate between 0 and 1)
        and (parser_disagreement_rate is null or parser_disagreement_rate between 0 and 1)
        and operational_paste_section_count >= 0
        and hwp_paste_comparable_lineage_count >= 0
        and (hwp_paste_parity_rate is null or hwp_paste_parity_rate between 0 and 1)
      );
  end if;
end;
$$;

create table if not exists internal_product_registration.benchmark_case_results (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  benchmark_run_id uuid not null references internal_product_registration.profile_benchmark_runs(id) on delete restrict,
  corpus_source_id uuid not null references internal_product_registration.benchmark_corpus_sources(id) on delete restrict,
  ground_truth_section_id uuid not null references internal_product_registration.benchmark_ground_truth_sections(id) on delete restrict,
  input_kind text not null check (input_kind in ('hwp', 'text')),
  build_id text not null,
  parser_version text not null,
  profile_version text,
  policy_version text not null,
  predicted_outcome text not null check (predicted_outcome in ('verified', 'degraded', 'blocked')),
  extraction_succeeded boolean not null,
  segment_exact boolean not null,
  safe_open boolean not null,
  critical_false_publish boolean not null default false,
  critical_field_count integer not null default 0 check (critical_field_count >= 0),
  critical_exact_count integer not null default 0 check (critical_exact_count >= 0),
  parser_fallback_used boolean not null default false,
  parser_disagreement boolean not null default false,
  field_diffs jsonb not null default '[]'::jsonb check (jsonb_typeof(field_diffs) = 'array'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  unique (benchmark_run_id, ground_truth_section_id),
  check (critical_exact_count <= critical_field_count)
);

create index if not exists idx_pr_benchmark_corpus_split
  on internal_product_registration.benchmark_corpus_sources(tenant_id, corpus_version, split, eligibility_state, input_kind);
create index if not exists idx_pr_benchmark_corpus_lineage
  on internal_product_registration.benchmark_corpus_sources(tenant_id, lineage_hash, split);
create index if not exists idx_pr_benchmark_ground_truth_corpus
  on internal_product_registration.benchmark_ground_truth_sections(corpus_source_id, review_state, section_index);
create index if not exists idx_pr_benchmark_reviews_section
  on internal_product_registration.benchmark_annotation_reviews(ground_truth_section_id, reviewer_slot, created_at desc);
create index if not exists idx_pr_benchmark_case_run
  on internal_product_registration.benchmark_case_results(benchmark_run_id, input_kind, safe_open, critical_false_publish);
create index if not exists idx_pr_benchmark_case_source
  on internal_product_registration.benchmark_case_results(corpus_source_id, ground_truth_section_id);
create index if not exists idx_pr_benchmark_frozen_verified
  on internal_product_registration.benchmark_corpus_sources(tenant_id, corpus_version, input_kind)
  where split = 'frozen' and eligibility_state = 'eligible';
create index if not exists idx_pr_source_uploads_lineage_hash
  on internal_product_registration.source_document_uploads(
    tenant_id,
    ((metadata->'sourceLineage'->>'normalizedTextHash')),
    created_at desc
  ) where metadata->'sourceLineage'->>'origin' = 'operational_admin_paste';

create or replace function internal_product_registration.enforce_benchmark_tenant_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  if tg_table_name = 'benchmark_corpus_sources' then
    select s.tenant_id into v_tenant_id
    from public.product_source_documents s
    where s.id = new.source_document_id;
  elsif tg_table_name = 'benchmark_ground_truth_sections' then
    select c.tenant_id into v_tenant_id
    from internal_product_registration.benchmark_corpus_sources c
    where c.id = new.corpus_source_id;
  elsif tg_table_name = 'benchmark_annotation_reviews' then
    select g.tenant_id into v_tenant_id
    from internal_product_registration.benchmark_ground_truth_sections g
    where g.id = new.ground_truth_section_id;
  else
    select g.tenant_id into v_tenant_id
    from internal_product_registration.benchmark_ground_truth_sections g
    where g.id = new.ground_truth_section_id;
  end if;
  if v_tenant_id is null or v_tenant_id <> new.tenant_id then
    raise exception 'REGISTRATION_BENCHMARK_TENANT_LINEAGE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pr_benchmark_corpus_tenant on internal_product_registration.benchmark_corpus_sources;
create trigger trg_pr_benchmark_corpus_tenant
before insert or update on internal_product_registration.benchmark_corpus_sources
for each row execute function internal_product_registration.enforce_benchmark_tenant_lineage();
drop trigger if exists trg_pr_benchmark_ground_truth_tenant on internal_product_registration.benchmark_ground_truth_sections;
create trigger trg_pr_benchmark_ground_truth_tenant
before insert or update on internal_product_registration.benchmark_ground_truth_sections
for each row execute function internal_product_registration.enforce_benchmark_tenant_lineage();
drop trigger if exists trg_pr_benchmark_review_tenant on internal_product_registration.benchmark_annotation_reviews;
create trigger trg_pr_benchmark_review_tenant
before insert or update on internal_product_registration.benchmark_annotation_reviews
for each row execute function internal_product_registration.enforce_benchmark_tenant_lineage();
drop trigger if exists trg_pr_benchmark_case_tenant on internal_product_registration.benchmark_case_results;
create trigger trg_pr_benchmark_case_tenant
before insert or update on internal_product_registration.benchmark_case_results
for each row execute function internal_product_registration.enforce_benchmark_tenant_lineage();

create or replace function internal_product_registration.reject_benchmark_case_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'REGISTRATION_BENCHMARK_APPEND_ONLY';
end;
$$;

drop trigger if exists trg_pr_benchmark_review_immutable on internal_product_registration.benchmark_annotation_reviews;
create trigger trg_pr_benchmark_review_immutable
before update or delete on internal_product_registration.benchmark_annotation_reviews
for each row execute function internal_product_registration.reject_benchmark_case_mutation();
drop trigger if exists trg_pr_benchmark_case_immutable on internal_product_registration.benchmark_case_results;
create trigger trg_pr_benchmark_case_immutable
before update or delete on internal_product_registration.benchmark_case_results
for each row execute function internal_product_registration.reject_benchmark_case_mutation();

alter table internal_product_registration.benchmark_corpus_sources enable row level security;
alter table internal_product_registration.benchmark_corpus_sources force row level security;
alter table internal_product_registration.benchmark_ground_truth_sections enable row level security;
alter table internal_product_registration.benchmark_ground_truth_sections force row level security;
alter table internal_product_registration.benchmark_annotation_reviews enable row level security;
alter table internal_product_registration.benchmark_annotation_reviews force row level security;
alter table internal_product_registration.benchmark_case_results enable row level security;
alter table internal_product_registration.benchmark_case_results force row level security;

revoke all on table internal_product_registration.benchmark_corpus_sources from public, anon, authenticated;
revoke all on table internal_product_registration.benchmark_ground_truth_sections from public, anon, authenticated;
revoke all on table internal_product_registration.benchmark_annotation_reviews from public, anon, authenticated;
revoke all on table internal_product_registration.benchmark_case_results from public, anon, authenticated;
grant all on table internal_product_registration.benchmark_corpus_sources to service_role;
grant all on table internal_product_registration.benchmark_ground_truth_sections to service_role;
grant all on table internal_product_registration.benchmark_annotation_reviews to service_role;
grant all on table internal_product_registration.benchmark_case_results to service_role;
grant usage, select on sequence internal_product_registration.benchmark_case_results_id_seq to service_role;

create or replace function public.get_product_registration_automation_readiness_metrics()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with latest_benchmarks as (
    select distinct on (supplier_layout_profile_id, coalesce(input_kind, 'combined'))
      supplier_layout_profile_id, input_kind, passed, exact_match_rate,
      critical_false_publish_count, sample_count, safe_open_count,
      safe_open_rate, wilson_lower_bound, segment_exact_match_rate,
      extraction_success_rate, parser_fallback_rate, parser_disagreement_rate,
      operational_paste_section_count, hwp_paste_comparable_lineage_count,
      hwp_paste_parity_rate, build_id, frozen_holdout, metrics
    from internal_product_registration.profile_benchmark_runs
    order by supplier_layout_profile_id, coalesce(input_kind, 'combined'), created_at desc
  ), latest_cohorts as (
    select distinct on (tenant_id, coalesce(supplier_key, ''), coalesce(parser_version, ''), coalesce(ocr_provider, ''))
      sample_count, critical_defect_count, publication_eligible, exact_match_rate, metrics
    from internal_product_registration.cohort_quality_metrics
    order by tenant_id, coalesce(supplier_key, ''), coalesce(parser_version, ''), coalesce(ocr_provider, ''), window_end desc
  ), frozen as (
    select
      count(*) filter (where c.input_kind = 'hwp') as hwp_source_count,
      count(*) filter (where c.input_kind = 'text') as text_source_count,
      count(g.id) as section_count
    from internal_product_registration.benchmark_corpus_sources c
    join internal_product_registration.benchmark_ground_truth_sections g
      on g.corpus_source_id = c.id and g.tenant_id = c.tenant_id
    where c.split = 'frozen'
      and c.eligibility_state = 'eligible'
      and g.review_state in ('double_verified', 'adjudicated')
  )
  select jsonb_build_object(
    'legacy_inventory_count', (select count(*) from public.travel_packages where tenant_id is not null and catalog_product_id is not null),
    'legacy_backfill_total_count', (select count(*) from internal_product_registration.legacy_backfill_jobs),
    'legacy_backfill_terminal_count', (select count(*) from internal_product_registration.legacy_backfill_jobs where status in ('verified', 'degraded', 'blocked')),
    'legacy_backfill_failed_count', (select count(*) from internal_product_registration.legacy_backfill_jobs where status = 'failed'),
    'v6_unique_source_count', (
      select count(distinct coalesce(d.sha256, j.source_document_id::text))
      from public.upload_jobs j
      left join public.product_source_documents d on d.id = j.source_document_id
      where j.v6_workflow_run_id is not null
    ),
    'v6_terminal_outcome_count', (select count(*) from public.upload_jobs where v6_outcome is not null),
    'v6_unfinished_job_count', (select count(*) from public.upload_jobs where v6_workflow_run_id is not null and v6_outcome is null),
    'v6_stale_unfinished_job_count', (
      select count(*) from public.upload_jobs
      where v6_workflow_run_id is not null and v6_outcome is null
        and coalesce(v6_last_heartbeat_at, created_at) < now() - interval '30 minutes'
    ),
    'media_ready_revision_count', (
      select count(distinct ml.product_revision_id)
      from internal_product_registration.media_revision_links ml
      join internal_product_registration.media_assets a on a.id = ml.media_asset_id and a.tenant_id = ml.tenant_id
      where a.rights_status in ('verified', 'attribution_required')
    ),
    'benchmark_passed_count', (select count(*) from latest_benchmarks where passed and frozen_holdout),
    'benchmark_exact_match_rate', (select min(exact_match_rate) from latest_benchmarks where passed and frozen_holdout),
    'benchmark_critical_false_publish_count', (select coalesce(sum(critical_false_publish_count), 0) from latest_benchmarks where frozen_holdout),
    'benchmark_build_ids', (select coalesce(jsonb_agg(distinct build_id) filter (where build_id is not null), '[]'::jsonb) from latest_benchmarks),
    'hwp_safe_open_rate', (select min(safe_open_rate) from latest_benchmarks where input_kind = 'hwp' and frozen_holdout),
    'text_paste_safe_open_rate', (select min(safe_open_rate) from latest_benchmarks where input_kind = 'text' and frozen_holdout),
    'safe_open_wilson_lower_bound', (select min(wilson_lower_bound) from latest_benchmarks where frozen_holdout),
    'segment_exact_match_rate', (select min(segment_exact_match_rate) from latest_benchmarks where frozen_holdout),
    'hwp_extraction_success_rate', (select min(extraction_success_rate) from latest_benchmarks where input_kind = 'hwp' and frozen_holdout),
    'parser_fallback_rate', (select max(parser_fallback_rate) from latest_benchmarks where input_kind = 'hwp' and frozen_holdout),
    'parser_disagreement_rate', (select max(parser_disagreement_rate) from latest_benchmarks where input_kind = 'hwp' and frozen_holdout),
    'frozen_holdout_section_count', (select section_count from frozen),
    'frozen_hwp_source_count', (select hwp_source_count from frozen),
    'frozen_text_source_count', (select text_source_count from frozen),
    'operational_paste_section_count', (select max(operational_paste_section_count) from latest_benchmarks where frozen_holdout),
    'operational_paste_source_count', (
      select count(distinct u.source_document_id)
      from internal_product_registration.source_document_uploads u
      join public.product_source_documents s on s.id = u.source_document_id and s.tenant_id = u.tenant_id
      where s.source_type = 'text'
        and u.metadata->'sourceLineage'->>'origin' = 'operational_admin_paste'
        and u.metadata->'sourceLineage'->>'normalizedTextHash' ~ '^[0-9a-f]{64}$'
    ),
    'hwp_paste_comparable_lineage_count', (select max(hwp_paste_comparable_lineage_count) from latest_benchmarks where frozen_holdout),
    'hwp_paste_exact_lineage_candidate_count', (
      select count(distinct u.metadata->'sourceLineage'->>'normalizedTextHash')
      from internal_product_registration.source_document_uploads u
      join public.product_source_documents s on s.id = u.source_document_id and s.tenant_id = u.tenant_id
      where s.source_type = 'text'
        and u.metadata->'sourceLineage'->>'origin' = 'operational_admin_paste'
        and exists (
          select 1
          from public.product_source_documents h
          join public.product_document_extractions e on e.source_document_id = h.id and e.tenant_id = h.tenant_id
          where h.tenant_id = s.tenant_id
            and h.source_type = 'hwp'
            and e.status = 'complete'
            and e.quality_diagnostics->>'normalizedTextHash' = u.metadata->'sourceLineage'->>'normalizedTextHash'
        )
    ),
    'hwp_paste_parity_rate', (select min(hwp_paste_parity_rate) from latest_benchmarks where frozen_holdout),
    'cohort_sample_count', (select coalesce(sum(sample_count), 0) from latest_cohorts),
    'cohort_critical_defect_count', (select coalesce(sum(critical_defect_count), 0) from latest_cohorts),
    'major_cohort_min_safe_open_rate', (
      select min((metrics->>'safe_open_rate')::numeric)
      from latest_cohorts
      where sample_count >= 30 and metrics ? 'safe_open_rate'
    ),
    'eligible_cohort_count', (select count(*) from latest_cohorts where publication_eligible)
  );
$$;

revoke all on function public.get_product_registration_automation_readiness_metrics() from public, anon, authenticated;
grant execute on function public.get_product_registration_automation_readiness_metrics() to service_role;
