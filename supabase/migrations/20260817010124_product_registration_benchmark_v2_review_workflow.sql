-- Benchmark V2: source-level blind double review, adjudication and pinned
-- engine-release provenance. This is forward-only and intentionally leaves
-- publication_freeze untouched.

alter table internal_product_registration.benchmark_corpus_sources
  add column if not exists reference_date date,
  add column if not exists annotation_schema_version text not null
    default 'product-registration-reviewed-benchmark-2';

alter table internal_product_registration.benchmark_ground_truth_sections
  add column if not exists boundary_start_anchor jsonb,
  add column if not exists boundary_end_anchor jsonb,
  add column if not exists product_identity_key text,
  add column if not exists publication_eligible boolean not null default true;

alter table internal_product_registration.benchmark_annotation_reviews
  alter column ground_truth_section_id drop not null,
  add column if not exists corpus_source_id uuid
    references internal_product_registration.benchmark_corpus_sources(id) on delete restrict,
  add column if not exists annotation_schema_version text not null
    default 'product-registration-reviewed-benchmark-2',
  add column if not exists reference_date date;

alter table internal_product_registration.profile_benchmark_runs
  alter column supplier_layout_profile_id drop not null,
  add column if not exists run_scope text not null default 'supplier',
  add column if not exists workflow_run_id text,
  add column if not exists release_manifest jsonb,
  add column if not exists release_manifest_hash text,
  add column if not exists corpus_hash text,
  add column if not exists reference_date date,
  add column if not exists annotation_schema_version text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'benchmark_review_exactly_one_scope_check'
      and conrelid = 'internal_product_registration.benchmark_annotation_reviews'::regclass
  ) then
    alter table internal_product_registration.benchmark_annotation_reviews
      add constraint benchmark_review_exactly_one_scope_check check (
        (corpus_source_id is not null and ground_truth_section_id is null)
        or (corpus_source_id is null and ground_truth_section_id is not null)
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'benchmark_review_human_reviewer_check'
      and conrelid = 'internal_product_registration.benchmark_annotation_reviews'::regclass
  ) then
    alter table internal_product_registration.benchmark_annotation_reviews
      add constraint benchmark_review_human_reviewer_check
      check (reviewer_id is not null) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profile_benchmark_release_hash_check'
      and conrelid = 'internal_product_registration.profile_benchmark_runs'::regclass
  ) then
    alter table internal_product_registration.profile_benchmark_runs
      add constraint profile_benchmark_release_hash_check check (
        (release_manifest is null and release_manifest_hash is null and corpus_hash is null)
        or (
          jsonb_typeof(release_manifest) = 'object'
          and release_manifest_hash ~ '^[0-9a-f]{64}$'
          and corpus_hash ~ '^[0-9a-f]{64}$'
          and reference_date is not null
          and annotation_schema_version = 'product-registration-reviewed-benchmark-2'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profile_benchmark_run_scope_check'
      and conrelid = 'internal_product_registration.profile_benchmark_runs'::regclass
  ) then
    alter table internal_product_registration.profile_benchmark_runs
      add constraint profile_benchmark_run_scope_check check (
        (run_scope = 'global' and supplier_layout_profile_id is null)
        or (run_scope = 'supplier' and supplier_layout_profile_id is not null)
      );
  end if;
end;
$$;

create unique index if not exists idx_pr_benchmark_global_release
  on internal_product_registration.profile_benchmark_runs(
    tenant_id, corpus_version, build_id, release_manifest_hash, coalesce(input_kind, 'combined')
  ) where run_scope = 'global';

create unique index if not exists idx_pr_benchmark_source_review_slot
  on internal_product_registration.benchmark_annotation_reviews(corpus_source_id, reviewer_slot)
  where corpus_source_id is not null;
create unique index if not exists idx_pr_benchmark_source_reviewer_independent
  on internal_product_registration.benchmark_annotation_reviews(corpus_source_id, reviewer_id)
  where corpus_source_id is not null;

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
    if new.corpus_source_id is not null then
      select c.tenant_id into v_tenant_id
      from internal_product_registration.benchmark_corpus_sources c
      where c.id = new.corpus_source_id;
    else
      select g.tenant_id into v_tenant_id
      from internal_product_registration.benchmark_ground_truth_sections g
      where g.id = new.ground_truth_section_id;
    end if;
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

create or replace function internal_product_registration.materialize_benchmark_v2_ground_truth(
  p_tenant_id uuid,
  p_corpus_source_id uuid,
  p_annotation jsonb,
  p_first_hash text,
  p_second_hash text,
  p_adjudication_hash text default null
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_section jsonb;
  v_index integer := 0;
  v_boundary_start integer;
  v_boundary_end integer;
  v_state text;
begin
  if p_annotation->>'schemaVersion' <> 'product-registration-reviewed-benchmark-2'
     or jsonb_typeof(p_annotation->'sections') <> 'array'
     or p_annotation->>'expectedDocumentClass' not in ('travel_product', 'non_travel', 'unsupported', 'corrupt') then
    raise exception 'BENCHMARK_V2_ANNOTATION_INVALID';
  end if;
  if exists (
    select 1 from internal_product_registration.benchmark_ground_truth_sections
    where tenant_id = p_tenant_id and corpus_source_id = p_corpus_source_id
  ) then
    raise exception 'BENCHMARK_GROUND_TRUTH_ALREADY_MATERIALIZED';
  end if;
  v_state := case when p_adjudication_hash is null then 'double_verified' else 'adjudicated' end;
  for v_section in select value from jsonb_array_elements(p_annotation->'sections')
  loop
    v_boundary_start := nullif(v_section#>>'{boundary,startAnchor,startOffset}', '')::integer;
    v_boundary_end := nullif(v_section#>>'{boundary,endAnchor,endOffset}', '')::integer;
    insert into internal_product_registration.benchmark_ground_truth_sections (
      tenant_id, corpus_source_id, section_index, boundary_start, boundary_end,
      boundary_start_anchor, boundary_end_anchor, product_identity_key,
      publication_eligible, annotation_schema_version, ground_truth,
      evidence_anchors, review_state, first_review_hash, second_review_hash,
      adjudication_hash
    ) values (
      p_tenant_id, p_corpus_source_id, v_index, v_boundary_start, v_boundary_end,
      v_section#>'{boundary,startAnchor}', v_section#>'{boundary,endAnchor}',
      encode(digest(convert_to(coalesce((v_section->'productIdentity')::text, '{}'), 'utf8'), 'sha256'), 'hex'),
      coalesce((v_section->>'sourceSalePricePresent')::boolean, false),
      'product-registration-reviewed-benchmark-2', v_section,
      coalesce(v_section->'evidenceAnchors', '[]'::jsonb), v_state,
      p_first_hash, p_second_hash, p_adjudication_hash
    );
    v_index := v_index + 1;
  end loop;
  update internal_product_registration.benchmark_corpus_sources
  set eligibility_state = 'eligible',
      source_class = p_annotation->>'expectedDocumentClass',
      reference_date = (p_annotation->>'referenceDate')::date,
      annotation_schema_version = 'product-registration-reviewed-benchmark-2',
      metadata = metadata || jsonb_build_object(
        'reviewState', v_state,
        'reviewedSectionCount', v_index,
        'sourceDepartureYear', p_annotation->'sourceDepartureYear',
        'expectedDocumentClass', p_annotation->>'expectedDocumentClass',
        'reviewResolvedAt', now()
      ),
      updated_at = now()
  where id = p_corpus_source_id and tenant_id = p_tenant_id;
  return v_index;
end;
$$;

create or replace function public.create_product_registration_benchmark_run_v2(
  p_tenant_id uuid,
  p_corpus_version text,
  p_input_kind text,
  p_release_manifest jsonb,
  p_release_manifest_hash text,
  p_start_claim text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_run_id uuid;
  v_db_corpus_hash text;
  v_build_id text;
begin
  if p_input_kind not in ('hwp', 'text', 'combined') then raise exception 'BENCHMARK_INPUT_KIND_INVALID'; end if;
  if p_release_manifest->>'schemaVersion' <> 'product-registration-engine-release-1'
     or p_release_manifest_hash !~ '^[0-9a-f]{64}$'
     or p_release_manifest->>'corpusHash' !~ '^[0-9a-f]{64}$'
     or p_release_manifest->>'termsPolicyHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'BENCHMARK_RELEASE_MANIFEST_INVALID';
  end if;
  select encode(digest(convert_to(coalesce(string_agg(
    concat_ws('|', c.id::text, c.source_hash, c.lineage_hash, c.input_kind,
      coalesce(c.metadata->>'pasteOrigin', ''), c.split,
      coalesce(c.supplier_key, ''), coalesce(c.document_family, '')),
    E'\n' order by c.id::text
  ), ''), 'utf8'), 'sha256'), 'hex') into v_db_corpus_hash
  from internal_product_registration.benchmark_corpus_sources c
  where c.tenant_id = p_tenant_id
    and c.corpus_version = p_corpus_version
    and c.eligibility_state = 'eligible'
    and c.split = 'frozen'
    and c.annotation_schema_version = 'product-registration-reviewed-benchmark-2'
    and (p_input_kind = 'combined' or c.input_kind = p_input_kind);
  if v_db_corpus_hash <> p_release_manifest->>'corpusHash' then
    raise exception 'BENCHMARK_RELEASE_CORPUS_HASH_MISMATCH';
  end if;
  v_build_id := p_release_manifest->>'gitCommit';
  select id into v_run_id
  from internal_product_registration.profile_benchmark_runs
  where tenant_id = p_tenant_id and corpus_version = p_corpus_version
    and build_id = v_build_id and release_manifest_hash = p_release_manifest_hash
    and coalesce(input_kind, 'combined') = p_input_kind and run_scope = 'global';
  if v_run_id is not null then
    return jsonb_build_object('benchmarkRunId', v_run_id, 'claimed', false);
  end if;
  insert into internal_product_registration.profile_benchmark_runs (
    tenant_id, supplier_layout_profile_id, run_scope, corpus_version, input_kind,
    metrics, critical_false_publish_count, exact_match_rate, passed, build_id,
    frozen_holdout, release_manifest, release_manifest_hash, corpus_hash,
    reference_date, annotation_schema_version, workflow_run_id
  ) values (
    p_tenant_id, null, 'global', p_corpus_version, p_input_kind,
    jsonb_build_object('state', 'running'), 0, null, false, v_build_id,
    true, p_release_manifest, p_release_manifest_hash,
    p_release_manifest->>'corpusHash', (p_release_manifest->>'referenceDate')::date,
    'product-registration-reviewed-benchmark-2', 'starting:' || p_start_claim
  ) returning id into v_run_id;
  return jsonb_build_object('benchmarkRunId', v_run_id, 'claimed', true);
end;
$$;

create or replace function public.bind_product_registration_benchmark_workflow_run_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid,
  p_start_claim text,
  p_workflow_run_id text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  update internal_product_registration.profile_benchmark_runs
  set workflow_run_id = p_workflow_run_id,
      metrics = metrics || jsonb_build_object('state', 'running', 'workflowRunId', p_workflow_run_id)
  where id = p_benchmark_run_id and tenant_id = p_tenant_id
    and workflow_run_id = 'starting:' || p_start_claim;
  if not found then raise exception 'BENCHMARK_WORKFLOW_CLAIM_LOST'; end if;
end;
$$;

create or replace function public.get_product_registration_benchmark_corpus_release_inputs_v2(
  p_tenant_id uuid,
  p_corpus_version text,
  p_input_kind text default 'combined'
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with eligible as (
    select c.*
    from internal_product_registration.benchmark_corpus_sources c
    where c.tenant_id = p_tenant_id
      and c.corpus_version = p_corpus_version
      and c.eligibility_state = 'eligible'
      and c.split = 'frozen'
      and c.annotation_schema_version = 'product-registration-reviewed-benchmark-2'
      and (p_input_kind = 'combined' or c.input_kind = p_input_kind)
  ), corpus as (
    select encode(digest(convert_to(coalesce(string_agg(
      concat_ws('|', id::text, source_hash, lineage_hash, input_kind,
        coalesce(metadata->>'pasteOrigin', ''), split,
        coalesce(supplier_key, ''), coalesce(document_family, '')),
      E'\n' order by id::text
    ), ''), 'utf8'), 'sha256'), 'hex') as corpus_hash,
    count(*) as source_count,
    count(*) filter (where split = 'frozen') as frozen_source_count,
    min(reference_date) as min_reference_date,
    max(reference_date) as max_reference_date
    from eligible
  ), profiles as (
    select encode(digest(convert_to(coalesce(string_agg(profile_hash, E'\n' order by profile_hash), 'none'), 'utf8'), 'sha256'), 'hex') as profile_hash
    from internal_product_registration.supplier_layout_profiles
    where tenant_id = p_tenant_id and activation_state = 'active'
  )
  select jsonb_build_object(
    'corpusHash', corpus.corpus_hash,
    'sourceCount', corpus.source_count,
    'frozenSourceCount', corpus.frozen_source_count,
    'referenceDate', case when corpus.min_reference_date = corpus.max_reference_date then corpus.min_reference_date else null end,
    'supplierProfileVersion', 'registry:' || profiles.profile_hash
  ) from corpus cross join profiles;
$$;

create or replace function public.get_product_registration_benchmark_run_cases_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
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
        'groundTruth', g.ground_truth
      ) order by g.section_index)
      from internal_product_registration.benchmark_ground_truth_sections g
      where g.corpus_source_id = c.id and g.tenant_id = c.tenant_id
        and g.review_state in ('double_verified', 'adjudicated')
    )
  ) order by c.id), '[]'::jsonb)
  from internal_product_registration.profile_benchmark_runs r
  join internal_product_registration.benchmark_corpus_sources c
    on c.tenant_id = r.tenant_id and c.corpus_version = r.corpus_version
    and c.eligibility_state = 'eligible'
    and c.split = 'frozen'
    and c.annotation_schema_version = 'product-registration-reviewed-benchmark-2'
    and (coalesce(r.input_kind, 'combined') = 'combined' or c.input_kind = r.input_kind)
  join public.product_source_documents d on d.id = c.source_document_id and d.tenant_id = c.tenant_id
  where r.id = p_benchmark_run_id and r.tenant_id = p_tenant_id and r.run_scope = 'global';
$$;

create or replace function public.get_product_registration_benchmark_runs_v2(
  p_tenant_id uuid,
  p_limit integer default 20
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'benchmarkRunId', id,
    'corpusVersion', corpus_version,
    'inputKind', input_kind,
    'workflowRunId', workflow_run_id,
    'buildId', build_id,
    'releaseManifestHash', release_manifest_hash,
    'referenceDate', reference_date,
    'sampleCount', sample_count,
    'safeOpenCount', safe_open_count,
    'safeOpenRate', safe_open_rate,
    'wilsonLowerBound', wilson_lower_bound,
    'criticalExactMatchRate', exact_match_rate,
    'criticalFalsePublishCount', critical_false_publish_count,
    'passed', passed,
    'state', metrics->>'state',
    'createdAt', created_at
  ) order by created_at desc), '[]'::jsonb)
  from (
    select * from internal_product_registration.profile_benchmark_runs
    where tenant_id = p_tenant_id and run_scope = 'global'
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) runs;
$$;

create or replace function public.get_product_registration_benchmark_v2_readiness()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with latest as (
    select * from internal_product_registration.profile_benchmark_runs
    where run_scope = 'global' and metrics->>'state' = 'complete'
    order by created_at desc limit 1
  ), current_profiles as (
    select tenant_id,
      'registry:' || encode(digest(convert_to(coalesce(string_agg(profile_hash, E'\n' order by profile_hash), 'none'), 'utf8'), 'sha256'), 'hex') as version
    from internal_product_registration.supplier_layout_profiles
    where activation_state = 'active'
    group by tenant_id
  )
  select coalesce((select jsonb_build_object(
    'release_manifest_hash', l.release_manifest_hash,
    'normalization_version', l.release_manifest->>'normalizationVersion',
    'terms_policy_hash', l.release_manifest->>'termsPolicyHash',
    'supplier_profile_version', l.release_manifest->>'supplierProfileVersion',
    'current_supplier_profile_version', coalesce(p.version, 'registry:' || encode(digest('none', 'sha256'), 'hex')),
    'corpus_hash', l.corpus_hash,
    'reference_date', l.reference_date,
    'annotation_schema_version', l.annotation_schema_version,
    'observed_safe_open_rate', l.safe_open_rate
  ) from latest l left join current_profiles p on p.tenant_id = l.tenant_id), '{}'::jsonb);
$$;

create or replace function public.persist_product_registration_benchmark_case_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid,
  p_payload jsonb
) returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare v_id bigint;
begin
  insert into internal_product_registration.benchmark_case_results (
    tenant_id, benchmark_run_id, corpus_source_id, ground_truth_section_id,
    input_kind, build_id, parser_version, profile_version, policy_version,
    predicted_outcome, extraction_succeeded, segment_exact, safe_open,
    critical_false_publish, critical_field_count, critical_exact_count,
    parser_fallback_used, parser_disagreement, field_diffs, metrics
  ) values (
    p_tenant_id, p_benchmark_run_id,
    (p_payload->>'corpusSourceId')::uuid, (p_payload->>'groundTruthSectionId')::uuid,
    p_payload->>'inputKind', p_payload->>'buildId', p_payload->>'parserVersion',
    nullif(p_payload->>'profileVersion', ''), p_payload->>'policyVersion',
    p_payload->>'predictedOutcome', coalesce((p_payload->>'extractionSucceeded')::boolean, false),
    coalesce((p_payload->>'segmentExact')::boolean, false), coalesce((p_payload->>'safeOpen')::boolean, false),
    coalesce((p_payload->>'criticalFalsePublish')::boolean, false),
    coalesce((p_payload->>'criticalFieldCount')::integer, 0), coalesce((p_payload->>'criticalExactCount')::integer, 0),
    coalesce((p_payload->>'parserFallbackUsed')::boolean, false), coalesce((p_payload->>'parserDisagreement')::boolean, false),
    coalesce(p_payload->'fieldDiffs', '[]'::jsonb), coalesce(p_payload->'metrics', '{}'::jsonb)
  ) on conflict (benchmark_run_id, ground_truth_section_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from internal_product_registration.benchmark_case_results
    where benchmark_run_id = p_benchmark_run_id
      and ground_truth_section_id = (p_payload->>'groundTruthSectionId')::uuid;
  end if;
  return v_id;
end;
$$;

create or replace function public.finalize_product_registration_benchmark_run_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid,
  p_summary jsonb,
  p_passed boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  update internal_product_registration.profile_benchmark_runs
  set metrics = p_summary || jsonb_build_object('state', 'complete'),
      sample_count = coalesce((p_summary->>'sampleCount')::integer, 0),
      safe_open_count = coalesce((p_summary->>'safeOpenCount')::integer, 0),
      safe_open_rate = (p_summary->>'safeOpenRate')::numeric,
      wilson_lower_bound = (p_summary->>'safeOpenWilsonLowerBound')::numeric,
      exact_match_rate = (p_summary->>'criticalExactMatchRate')::numeric,
      segment_exact_match_rate = (p_summary->>'segmentExactMatchRate')::numeric,
      extraction_success_rate = (p_summary->>'extractionSuccessRate')::numeric,
      parser_fallback_rate = (p_summary->>'parserFallbackRate')::numeric,
      parser_disagreement_rate = (p_summary->>'parserDisagreementRate')::numeric,
      critical_false_publish_count = coalesce((p_summary->>'criticalFalsePublishCount')::integer, 0),
      passed = p_passed
  where id = p_benchmark_run_id and tenant_id = p_tenant_id and run_scope = 'global';
  if not found then raise exception 'BENCHMARK_RUN_NOT_FOUND'; end if;
end;
$$;

create or replace function public.submit_product_registration_benchmark_review_atomic(
  p_tenant_id uuid,
  p_corpus_source_id uuid,
  p_reviewer_id uuid,
  p_reviewer_slot text,
  p_annotation jsonb,
  p_annotation_hash text,
  p_evidence_anchors jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_source internal_product_registration.benchmark_corpus_sources%rowtype;
  v_first internal_product_registration.benchmark_annotation_reviews%rowtype;
  v_second internal_product_registration.benchmark_annotation_reviews%rowtype;
  v_section_count integer := 0;
  v_state text := 'annotating';
begin
  if p_reviewer_id is null then raise exception 'BENCHMARK_AUTHENTICATED_REVIEWER_REQUIRED'; end if;
  if p_reviewer_slot not in ('first', 'second', 'adjudicator') then raise exception 'BENCHMARK_REVIEW_SLOT_INVALID'; end if;
  if p_annotation_hash !~ '^[0-9a-f]{64}$' then raise exception 'BENCHMARK_REVIEW_HASH_INVALID'; end if;
  if p_annotation->>'schemaVersion' <> 'product-registration-reviewed-benchmark-2'
     or jsonb_typeof(p_annotation->'sections') <> 'array'
     or jsonb_array_length(p_annotation->'sections') = 0
     or p_annotation->>'expectedDocumentClass' not in ('travel_product', 'non_travel', 'unsupported', 'corrupt') then
    raise exception 'BENCHMARK_V2_ANNOTATION_INVALID';
  end if;
  if jsonb_typeof(p_evidence_anchors) <> 'array' then raise exception 'BENCHMARK_EVIDENCE_INVALID'; end if;

  select * into v_source
  from internal_product_registration.benchmark_corpus_sources
  where id = p_corpus_source_id and tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'BENCHMARK_CORPUS_SOURCE_NOT_FOUND'; end if;
  if v_source.eligibility_state in ('eligible', 'excluded', 'retired') then
    raise exception 'BENCHMARK_CORPUS_SOURCE_ALREADY_RESOLVED';
  end if;
  if exists (
    select 1 from internal_product_registration.benchmark_annotation_reviews
    where corpus_source_id = p_corpus_source_id and reviewer_id = p_reviewer_id
  ) then
    raise exception 'BENCHMARK_REVIEWER_MUST_BE_INDEPENDENT';
  end if;

  if p_reviewer_slot = 'first' and exists (
    select 1 from internal_product_registration.benchmark_annotation_reviews
    where corpus_source_id = p_corpus_source_id and reviewer_slot = 'first'
  ) then raise exception 'BENCHMARK_FIRST_REVIEW_EXISTS'; end if;
  if p_reviewer_slot = 'second' and not exists (
    select 1 from internal_product_registration.benchmark_annotation_reviews
    where corpus_source_id = p_corpus_source_id and reviewer_slot = 'first'
  ) then raise exception 'BENCHMARK_FIRST_REVIEW_REQUIRED'; end if;
  if p_reviewer_slot = 'adjudicator' and not exists (
    select 1 from internal_product_registration.benchmark_annotation_reviews f
    join internal_product_registration.benchmark_annotation_reviews s
      on s.corpus_source_id = f.corpus_source_id and s.reviewer_slot = 'second'
    where f.corpus_source_id = p_corpus_source_id and f.reviewer_slot = 'first'
      and f.annotation_hash <> s.annotation_hash
  ) then raise exception 'BENCHMARK_ADJUDICATION_CONFLICT_REQUIRED'; end if;

  insert into internal_product_registration.benchmark_annotation_reviews (
    tenant_id, corpus_source_id, ground_truth_section_id, reviewer_slot,
    annotation_hash, annotation, evidence_anchors, blinded_to_engine,
    reviewer_id, annotation_schema_version, reference_date
  ) values (
    p_tenant_id, p_corpus_source_id, null, p_reviewer_slot,
    p_annotation_hash, p_annotation, p_evidence_anchors, true,
    p_reviewer_id, 'product-registration-reviewed-benchmark-2',
    (p_annotation->>'referenceDate')::date
  );

  select * into v_first from internal_product_registration.benchmark_annotation_reviews
  where corpus_source_id = p_corpus_source_id and reviewer_slot = 'first';
  select * into v_second from internal_product_registration.benchmark_annotation_reviews
  where corpus_source_id = p_corpus_source_id and reviewer_slot = 'second';

  if p_reviewer_slot = 'first' then
    v_state := 'first_verified';
  elsif p_reviewer_slot = 'second' and v_first.annotation_hash = v_second.annotation_hash then
    v_state := 'double_verified';
    v_section_count := internal_product_registration.materialize_benchmark_v2_ground_truth(
      p_tenant_id, p_corpus_source_id, p_annotation,
      v_first.annotation_hash, v_second.annotation_hash, null
    );
  elsif p_reviewer_slot = 'second' then
    v_state := 'conflict';
  elsif p_reviewer_slot = 'adjudicator' then
    v_state := 'adjudicated';
    v_section_count := internal_product_registration.materialize_benchmark_v2_ground_truth(
      p_tenant_id, p_corpus_source_id, p_annotation,
      v_first.annotation_hash, v_second.annotation_hash, p_annotation_hash
    );
  end if;

  if v_state not in ('double_verified', 'adjudicated') then
    update internal_product_registration.benchmark_corpus_sources
    set eligibility_state = 'annotating',
        metadata = metadata || jsonb_build_object('reviewState', v_state),
        updated_at = now()
    where id = p_corpus_source_id and tenant_id = p_tenant_id;
  end if;
  return jsonb_build_object('state', v_state, 'sectionCount', v_section_count);
end;
$$;

create or replace function public.get_product_registration_benchmark_review_queue(
  p_tenant_id uuid,
  p_reviewer_id uuid,
  p_limit integer default 10
) returns table (
  corpus_source_id uuid,
  source_document_id uuid,
  corpus_version text,
  source_hash text,
  lineage_hash text,
  input_kind text,
  split text,
  supplier_key text,
  document_family text,
  original_filename text,
  source_text text,
  source_nodes jsonb,
  reviewer_slot text,
  reference_date date
)
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select c.id, c.source_document_id, c.corpus_version, c.source_hash,
    c.lineage_hash, c.input_kind, c.split, c.supplier_key, c.document_family,
    d.original_filename,
    coalesce(e.document_ir->>'text', d.metadata->>'rawText', ''),
    coalesce(e.document_ir->'nodes', '[]'::jsonb),
    case
      when not exists (select 1 from internal_product_registration.benchmark_annotation_reviews r where r.corpus_source_id = c.id and r.reviewer_slot = 'first') then 'first'
      when not exists (select 1 from internal_product_registration.benchmark_annotation_reviews r where r.corpus_source_id = c.id and r.reviewer_slot = 'second') then 'second'
      else 'adjudicator'
    end,
    c.reference_date
  from internal_product_registration.benchmark_corpus_sources c
  join public.product_source_documents d on d.id = c.source_document_id and d.tenant_id = c.tenant_id
  left join lateral (
    select x.document_ir
    from public.product_document_extractions x
    where x.source_document_id = d.id and x.status = 'complete'
    order by x.created_at desc
    limit 1
  ) e on true
  where c.tenant_id = p_tenant_id
    and c.eligibility_state in ('candidate', 'annotating')
    and not exists (
      select 1 from internal_product_registration.benchmark_annotation_reviews own
      where own.corpus_source_id = c.id and own.reviewer_id = p_reviewer_id
    )
    and (
      not exists (select 1 from internal_product_registration.benchmark_annotation_reviews r where r.corpus_source_id = c.id and r.reviewer_slot = 'second')
      or exists (
        select 1
        from internal_product_registration.benchmark_annotation_reviews f
        join internal_product_registration.benchmark_annotation_reviews s
          on s.corpus_source_id = f.corpus_source_id and s.reviewer_slot = 'second'
        where f.corpus_source_id = c.id and f.reviewer_slot = 'first'
          and f.annotation_hash <> s.annotation_hash
          and not exists (select 1 from internal_product_registration.benchmark_annotation_reviews a where a.corpus_source_id = c.id and a.reviewer_slot = 'adjudicator')
      )
    )
  order by case c.split when 'development' then 1 when 'calibration' then 2 else 3 end,
    c.created_at, c.id
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.submit_product_registration_benchmark_review_atomic(uuid, uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_product_registration_benchmark_review_atomic(uuid, uuid, uuid, text, jsonb, text, jsonb) to service_role;
revoke all on function public.get_product_registration_benchmark_review_queue(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_review_queue(uuid, uuid, integer) to service_role;
revoke all on function internal_product_registration.materialize_benchmark_v2_ground_truth(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function internal_product_registration.materialize_benchmark_v2_ground_truth(uuid, uuid, jsonb, text, text, text) to service_role;
revoke all on function public.create_product_registration_benchmark_run_v2(uuid, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_product_registration_benchmark_run_v2(uuid, text, text, jsonb, text, text) to service_role;
revoke all on function public.bind_product_registration_benchmark_workflow_run_v2(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.bind_product_registration_benchmark_workflow_run_v2(uuid, uuid, text, text) to service_role;
revoke all on function public.get_product_registration_benchmark_corpus_release_inputs_v2(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_corpus_release_inputs_v2(uuid, text, text) to service_role;
revoke all on function public.get_product_registration_benchmark_run_cases_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_run_cases_v2(uuid, uuid) to service_role;
revoke all on function public.get_product_registration_benchmark_runs_v2(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_runs_v2(uuid, integer) to service_role;
revoke all on function public.get_product_registration_benchmark_v2_readiness() from public, anon, authenticated;
grant execute on function public.get_product_registration_benchmark_v2_readiness() to service_role;
revoke all on function public.persist_product_registration_benchmark_case_v2(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_product_registration_benchmark_case_v2(uuid, uuid, jsonb) to service_role;
revoke all on function public.finalize_product_registration_benchmark_run_v2(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.finalize_product_registration_benchmark_run_v2(uuid, uuid, jsonb, boolean) to service_role;

comment on function public.submit_product_registration_benchmark_review_atomic(uuid, uuid, uuid, text, jsonb, text, jsonb) is
  'Service-role-only append-only blind benchmark review. Two different authenticated reviewers are mandatory; conflicting reviews require a third reviewer.';
