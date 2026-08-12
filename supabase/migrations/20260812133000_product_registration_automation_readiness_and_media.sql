-- Product registration automation release gates and licensed reference media.
-- Forward-only: this migration does not publish, unfreeze, or change authority.

create or replace function public.claim_product_registration_legacy_backfill(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform internal_product_registration.sync_legacy_backfill_terminal_states();
  with candidates as (
    select p.tenant_id, p.catalog_product_id, p.id as package_id
    from public.travel_packages p
    left join internal_product_registration.legacy_backfill_jobs b
      on b.tenant_id = p.tenant_id and b.catalog_product_id = p.catalog_product_id
    where p.catalog_product_id is not null
      and p.tenant_id is not null
      and (
        b.id is null
        or (b.status = 'failed' and b.attempt_count < 3 and b.updated_at < now() - interval '30 minutes')
      )
    order by p.created_at, p.id
    for update of p skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  ), claimed as (
    insert into internal_product_registration.legacy_backfill_jobs (
      tenant_id, catalog_product_id, package_id, status, attempt_count, last_error, updated_at
    )
    select tenant_id, catalog_product_id, package_id, 'reserved', 1, null, now()
    from candidates
    on conflict (tenant_id, catalog_product_id) do update
      set status = 'reserved',
          attempt_count = internal_product_registration.legacy_backfill_jobs.attempt_count + 1,
          last_error = null,
          updated_at = now(),
          workflow_job_id = null,
          workflow_run_id = null,
          source_document_id = null,
          terminal_at = null
      where internal_product_registration.legacy_backfill_jobs.status = 'failed'
        and internal_product_registration.legacy_backfill_jobs.attempt_count < 3
    returning id, tenant_id, catalog_product_id, package_id, attempt_count
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_result
  from claimed;
  return v_result;
end;
$$;

create or replace function public.fail_product_registration_legacy_backfill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_row internal_product_registration.legacy_backfill_jobs%rowtype;
  v_error text := left(coalesce(p_payload->>'error', 'LEGACY_BACKFILL_START_FAILED'), 2000);
  v_terminal_status text := case
    when v_error like 'LEGACY_SOURCE_TEXT_UNAVAILABLE%' then 'blocked'
    else 'failed'
  end;
begin
  update internal_product_registration.legacy_backfill_jobs
  set status = v_terminal_status,
      last_error = v_error,
      terminal_at = now(),
      updated_at = now()
  where id = nullif(p_payload->>'backfill_id', '')::uuid
    and tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
    and status = 'reserved'
  returning * into v_row;
  if not found then raise exception 'REGISTRATION_LEGACY_BACKFILL_FAIL_CONFLICT'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

create or replace function public.link_product_registration_reference_media(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_external_url text := nullif(btrim(p_payload->>'external_url'), '');
  v_sha256 text := nullif(btrim(p_payload->>'sha256'), '');
  v_asset_id uuid;
  v_link_id uuid;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null then
    raise exception 'REGISTRATION_MEDIA_LINEAGE_REQUIRED';
  end if;
  if v_external_url is null or v_external_url !~ '^https://' then
    raise exception 'REGISTRATION_MEDIA_HTTPS_URL_REQUIRED';
  end if;
  if v_sha256 is null or v_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_MEDIA_SHA256_INVALID';
  end if;
  if not exists (
    select 1
    from public.product_registration_v5_revisions r
    where r.id = v_revision_id
      and r.tenant_id = v_tenant_id
      and r.catalog_product_id = v_catalog_product_id
  ) then
    raise exception 'REGISTRATION_MEDIA_REVISION_LINEAGE_MISMATCH';
  end if;

  insert into internal_product_registration.media_assets (
    tenant_id, external_url, media_type, provenance_type, rights_status,
    rights_holder, license_reference, attribution_text, sha256, metadata
  ) values (
    v_tenant_id,
    v_external_url,
    'image',
    'destination_reference',
    'attribution_required',
    nullif(btrim(p_payload->>'rights_holder'), ''),
    coalesce(nullif(btrim(p_payload->>'license_reference'), ''), 'https://www.pexels.com/license/'),
    nullif(btrim(p_payload->>'attribution_text'), ''),
    v_sha256,
    coalesce(p_payload->'metadata', '{}'::jsonb)
  )
  on conflict (tenant_id, sha256) do update
    set external_url = excluded.external_url
  returning id into v_asset_id;

  insert into internal_product_registration.media_revision_links (
    tenant_id, catalog_product_id, product_revision_id, media_asset_id,
    role, customer_label, sort_order
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_asset_id,
    'hero',
    coalesce(nullif(btrim(p_payload->>'customer_label'), ''), '여행지 참고 이미지 · 실제 일정과 다를 수 있습니다.'),
    0
  )
  on conflict (product_revision_id, media_asset_id, role) do update
    set customer_label = excluded.customer_label
  returning id into v_link_id;

  return jsonb_build_object('asset_id', v_asset_id, 'link_id', v_link_id, 'created', true);
end;
$$;

create or replace function public.get_product_registration_automation_readiness_metrics()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with latest_benchmarks as (
    select distinct on (supplier_layout_profile_id)
      supplier_layout_profile_id,
      passed,
      exact_match_rate,
      critical_false_publish_count
    from internal_product_registration.profile_benchmark_runs
    order by supplier_layout_profile_id, created_at desc
  ), latest_cohorts as (
    select distinct on (tenant_id, coalesce(supplier_key, ''), coalesce(parser_version, ''), coalesce(ocr_provider, ''))
      sample_count,
      critical_defect_count,
      publication_eligible
    from internal_product_registration.cohort_quality_metrics
    order by tenant_id, coalesce(supplier_key, ''), coalesce(parser_version, ''), coalesce(ocr_provider, ''), window_end desc
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
      where v6_workflow_run_id is not null
        and v6_outcome is null
        and coalesce(v6_last_heartbeat_at, created_at) < now() - interval '30 minutes'
    ),
    'media_ready_revision_count', (
      select count(distinct ml.product_revision_id)
      from internal_product_registration.media_revision_links ml
      join internal_product_registration.media_assets a on a.id = ml.media_asset_id and a.tenant_id = ml.tenant_id
      where a.rights_status in ('verified', 'attribution_required')
    ),
    'benchmark_passed_count', (select count(*) from latest_benchmarks where passed),
    'benchmark_exact_match_rate', (select min(exact_match_rate) from latest_benchmarks where passed),
    'benchmark_critical_false_publish_count', (select coalesce(sum(critical_false_publish_count), 0) from latest_benchmarks where passed),
    'cohort_sample_count', (select coalesce(sum(sample_count), 0) from latest_cohorts),
    'cohort_critical_defect_count', (select coalesce(sum(critical_defect_count), 0) from latest_cohorts),
    'eligible_cohort_count', (select count(*) from latest_cohorts where publication_eligible)
  );
$$;

revoke all on function public.claim_product_registration_legacy_backfill(integer) from public, anon, authenticated;
revoke all on function public.fail_product_registration_legacy_backfill(jsonb) from public, anon, authenticated;
revoke all on function public.link_product_registration_reference_media(jsonb) from public, anon, authenticated;
revoke all on function public.get_product_registration_automation_readiness_metrics() from public, anon, authenticated;
grant execute on function public.claim_product_registration_legacy_backfill(integer) to service_role;
grant execute on function public.fail_product_registration_legacy_backfill(jsonb) to service_role;
grant execute on function public.link_product_registration_reference_media(jsonb) to service_role;
grant execute on function public.get_product_registration_automation_readiness_metrics() to service_role;
