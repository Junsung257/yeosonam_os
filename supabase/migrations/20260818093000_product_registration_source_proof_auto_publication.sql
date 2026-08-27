-- Allow an individually proven source to publish without waiting for a
-- permanent cohort metric. This is intentionally narrower than relaxing the
-- cohort gate: the database replays the immutable revision, claim evidence,
-- snapshot lineage, and both mobile proof surfaces for this exact operation.
-- The temporary cohort row is deleted in the same transaction after the CAS
-- publication, so it cannot authorize unrelated future products.

create or replace function internal_product_registration.source_proof_auto_eligible(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_proof_run_id uuid := nullif(p_payload->>'proof_run_id', '')::uuid;
  v_snapshot_hash text := p_payload->>'snapshot_hash';
  v_source_document_id uuid;
  v_proof_result jsonb;
  v_claim_count integer;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null
    or v_revision_id is null or v_snapshot_id is null or v_proof_run_id is null
    or v_snapshot_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select r.source_document_id
    into v_source_document_id
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id
    and r.status in ('candidate', 'verified', 'approved', 'published');
  if not found then return false; end if;

  if not exists (
    select 1
    from public.public_package_snapshots s
    where s.id = v_snapshot_id
      and s.tenant_id = v_tenant_id
      and s.catalog_product_id = v_catalog_product_id
      and s.package_id = v_package_id
      and s.canonical_revision_id = v_revision_id
      and s.snapshot_hash = v_snapshot_hash
      and s.status in ('candidate', 'approved', 'published')
  ) then
    return false;
  end if;

  select p.result
    into v_proof_result
  from public.product_registration_v5_proof_runs p
  where p.id = v_proof_run_id
    and p.tenant_id = v_tenant_id
    and p.catalog_product_id = v_catalog_product_id
    and p.package_id = v_package_id
    and p.revision_id = v_revision_id
    and p.public_snapshot_id = v_snapshot_id
    and p.snapshot_hash = v_snapshot_hash
    and p.status = 'passed'
    and p.result #>> '{chromeProof,status}' = 'passed';
  if not found then return false; end if;

  if jsonb_array_length(coalesce(v_proof_result #> '{chromeProof,surfaces}', '[]'::jsonb)) <> 2
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_proof_result #> '{chromeProof,surfaces}', '[]'::jsonb)) surface
      where surface->>'status' <> 'passed'
        or surface->>'ctaOpened' <> 'true'
        or jsonb_array_length(coalesce(surface->'hydrationErrors', '[]'::jsonb)) <> 0
    ) then
    return false;
  end if;

  select count(*)
    into v_claim_count
  from public.product_registration_v5_claims c
  where c.revision_id = v_revision_id;
  if coalesce(v_claim_count, 0) = 0 then return false; end if;

  if exists (
    select 1
    from public.product_registration_v5_claims c
    where c.revision_id = v_revision_id
      and c.criticality in ('critical', 'high')
      and (
        c.evidence_status <> 'verified'
        or c.conflict_status <> 'none'
        or not exists (
          select 1
          from public.product_registration_v5_claim_evidence ce
          where ce.claim_id = c.id
            and ce.source_document_id = v_source_document_id
        )
      )
  ) then
    return false;
  end if;

  return true;
exception when others then
  -- Eligibility must fail closed if a future schema or JSON shape changes.
  return false;
end;
$$;

revoke all on function internal_product_registration.source_proof_auto_eligible(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.source_proof_auto_eligible(jsonb)
  to service_role;

create or replace function public.publish_product_registration_snapshot_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_policy_version text := nullif(btrim(p_payload->>'policy_version'), '');
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_parser_version text;
  v_temp_cohort_id uuid;
begin
  begin
    return internal_product_registration.publish_snapshot_atomic(p_payload);
  exception when others then
    if sqlerrm <> 'REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE' then
      raise;
    end if;
  end;

  if not internal_product_registration.source_proof_auto_eligible(p_payload) then
    raise exception 'REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE';
  end if;

  select r.normalization_version
    into v_parser_version
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id;
  if v_parser_version is null or v_policy_version is null then
    raise exception 'REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE';
  end if;

  insert into internal_product_registration.cohort_quality_metrics (
    tenant_id, supplier_key, parser_version, policy_version,
    window_start, window_end, sample_count, auto_publish_count,
    critical_defect_count, exact_match_rate, publication_eligible, metrics
  ) values (
    v_tenant_id, null, v_parser_version, v_policy_version,
    now(), now() + interval '1 minute', 1, 1,
    0, null, true,
    jsonb_build_object(
      'mode', 'source_evidence_and_mobile_proof',
      'benchmarkEligible', false,
      'operationKey', v_operation_key,
      'sourceScoped', true
    )
  ) returning id into v_temp_cohort_id;

  begin
    v_result := internal_product_registration.publish_snapshot_atomic(p_payload);
  exception when others then
    delete from internal_product_registration.cohort_quality_metrics
    where id = v_temp_cohort_id;
    raise;
  end;

  delete from internal_product_registration.cohort_quality_metrics
  where id = v_temp_cohort_id;

  return v_result || jsonb_build_object(
    'eligibility_mode', 'source_evidence_and_mobile_proof'
  );
end;
$$;

revoke all on function public.publish_product_registration_snapshot_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_product_registration_snapshot_atomic(jsonb)
  to service_role;
