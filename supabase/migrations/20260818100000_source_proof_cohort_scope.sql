-- Scope source-evidence auto-publication to the exact revision. The cohort
-- metrics table is append-only, so source-scoped eligibility rows expire
-- naturally instead of being deleted after publication.

create or replace function internal_product_registration.publish_snapshot_atomic(p_payload jsonb)
returns jsonb
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
  v_expected_pointer_version bigint := nullif(p_payload->>'expected_pointer_version', '')::bigint;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_snapshot_hash text := p_payload->>'snapshot_hash';
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'customer');
  v_locale text := coalesce(nullif(p_payload->>'locale', ''), 'ko-KR');
  v_policy_version text := p_payload->>'policy_version';
  v_outcome text := p_payload->>'outcome';
  v_revision public.product_registration_v5_revisions%rowtype;
  v_snapshot public.public_package_snapshots%rowtype;
  v_proof public.product_registration_v5_proof_runs%rowtype;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_mode text;
  v_freeze boolean;
  v_supplier text;
  v_next_version bigint;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_inserted boolean := false;
  v_sale_blocked boolean := false;
  v_cohort_eligible boolean := false;
  v_result jsonb;
begin
  perform set_config('app.product_registration_writer', 'publication-kernel', true);
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null
    or v_revision_id is null or v_snapshot_id is null or v_proof_run_id is null then
    raise exception 'REGISTRATION_PUBLICATION_LINEAGE_REQUIRED';
  end if;
  if v_snapshot_hash !~ '^[0-9a-f]{64}$' then raise exception 'REGISTRATION_PUBLICATION_SNAPSHOT_HASH_INVALID'; end if;
  if v_expected_pointer_version is null or v_expected_pointer_version < 0 then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSION_INVALID';
  end if;
  if v_operation_key is null then raise exception 'REGISTRATION_PUBLICATION_OPERATION_KEY_REQUIRED'; end if;
  if v_outcome not in ('published_verified', 'published_degraded') then
    raise exception 'REGISTRATION_PUBLICATION_OUTCOME_INVALID';
  end if;

  select authority_mode, publication_freeze into v_mode, v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;
  if v_mode <> 'kernel' then raise exception 'REGISTRATION_PUBLICATION_KERNEL_AUTHORITY_REQUIRED'; end if;
  if v_freeze then raise exception 'REGISTRATION_PUBLICATION_FROZEN'; end if;

  v_request_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.product_registration_v5_idempotency_ledger (
    operation_key, operation_type, tenant_id, aggregate_id, request_hash, status
  ) values (
    v_operation_key, 'publish_product_registration_snapshot_atomic', v_tenant_id,
    v_catalog_product_id, v_request_hash, 'started'
  ) on conflict (operation_key) do nothing
  returning true into v_inserted;

  select request_hash, status, response into v_existing_hash, v_existing_status, v_existing_response
  from public.product_registration_v5_idempotency_ledger
  where operation_key = v_operation_key;
  if v_existing_hash is distinct from v_request_hash then raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_REUSED'; end if;
  if v_existing_status = 'succeeded' then return coalesce(v_existing_response, '{}'::jsonb); end if;
  if not v_inserted then raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_IN_PROGRESS'; end if;

  select * into v_revision
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id
  for share;
  if not found then raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_FOUND'; end if;
  if v_revision.status not in ('candidate', 'verified', 'approved', 'published') then
    raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_revision.status;
  end if;

  select coalesce(
    nullif(cp.metadata->>'supplier_key', ''),
    nullif(cp.metadata->>'land_operator', ''),
    nullif(cp.metadata->>'supplier_code', '')
  ) into v_supplier
  from internal_product_registration.catalog_products cp
  where cp.id = v_catalog_product_id and cp.tenant_id = v_tenant_id;
  if not found then raise exception 'REGISTRATION_PUBLICATION_CATALOG_IDENTITY_MISMATCH'; end if;
  if not exists (
    select 1 from public.travel_packages p
    where p.id = v_package_id
      and p.catalog_product_id = v_catalog_product_id
      and p.tenant_id = v_tenant_id
  ) then raise exception 'REGISTRATION_PUBLICATION_PACKAGE_IDENTITY_MISMATCH'; end if;

  -- Permanent benchmark rows have no sourceRevisionId and remain eligible for
  -- their normal supplier/parser cohort. Source-proof rows are exact-revision
  -- scoped and must still be inside their short validity window.
  execute $sql$
    select coalesce((
      select q.publication_eligible
      from internal_product_registration.cohort_quality_metrics q
      where q.tenant_id = $1
        and (q.supplier_key = $2 or q.supplier_key is null)
        and (q.parser_version = $3 or q.parser_version is null)
        and q.policy_version = $4
        and q.critical_defect_count = 0
        and q.window_end > now()
        and (
          q.metrics->>'sourceRevisionId' is null
          or q.metrics->>'sourceRevisionId' = $5
        )
      order by
        (q.metrics->>'sourceRevisionId' is not null)::integer desc,
        (q.supplier_key is not null)::integer desc,
        (q.parser_version is not null)::integer desc,
        q.window_end desc
      limit 1
    ), false)
  $sql$ into v_cohort_eligible using
    v_tenant_id, v_supplier, v_revision.normalization_version, v_policy_version,
    v_revision_id::text;
  if not v_cohort_eligible then raise exception 'REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE'; end if;

  execute $sql$
    select exists (
      select 1
      from internal_product_registration.package_availability_overlays a
      where a.tenant_id = $1
        and a.catalog_product_id = $2
        and a.channel = $3
        and a.sale_state in ('closed', 'sold_out', 'suspended')
        and (a.expires_at is null or a.expires_at > now())
    )
  $sql$ into v_sale_blocked using v_tenant_id, v_catalog_product_id, v_channel;
  if v_sale_blocked then raise exception 'REGISTRATION_PUBLICATION_SALE_BLOCKED'; end if;

  if exists (
    select 1 from public.product_registration_v5_kill_switches k
    where k.active and (k.expires_at is null or k.expires_at > now())
      and (
        k.scope = 'global'
        or (k.scope = 'product' and k.scope_key in (v_catalog_product_id::text, v_package_id::text, '*'))
        or (k.scope = 'supplier' and k.scope_key in (coalesce(v_supplier, ''), '*'))
        or (k.scope = 'parser' and k.scope_key in ('registration-kernel', 'product-registration-v6', '*'))
        or k.scope in ('model', 'ocr_provider', 'transport_provider')
      )
  ) then raise exception 'REGISTRATION_PUBLICATION_KILL_SWITCH_ACTIVE'; end if;

  select * into v_snapshot
  from public.public_package_snapshots s
  where s.id = v_snapshot_id
    and s.package_id = v_package_id
    and s.catalog_product_id = v_catalog_product_id
    and s.canonical_revision_id = v_revision_id
    and s.snapshot_hash = v_snapshot_hash
  for share;
  if not found then raise exception 'REGISTRATION_PUBLICATION_SNAPSHOT_MISMATCH'; end if;

  select * into v_proof
  from public.product_registration_v5_proof_runs p
  where p.id = v_proof_run_id
    and p.tenant_id = v_tenant_id
    and p.catalog_product_id = v_catalog_product_id
    and p.package_id = v_package_id
    and p.revision_id = v_revision_id
    and p.public_snapshot_id = v_snapshot_id
    and p.snapshot_hash = v_snapshot_hash
    and p.renderer_build_id = v_snapshot.renderer_build_id
    and p.status = 'passed';
  if not found then raise exception 'REGISTRATION_PUBLICATION_PROOF_MISMATCH'; end if;

  -- A candidate revision is not publishable through the legacy pointer
  -- trigger. Once the complete revision/evidence/proof gates above have
  -- passed, promote only its lifecycle status (canonical facts remain
  -- append-only) before the CAS pointer update.
  if v_revision.status = 'candidate' then
    perform public.promote_product_registration_v5_revision(v_revision_id, 'verified');
  end if;

  insert into public.product_registration_v5_publication_pointers (
    tenant_id, catalog_product_id, package_id, channel, locale, state, pointer_version
  ) values (
    v_tenant_id, v_catalog_product_id, v_package_id, v_channel, v_locale, 'draft', 0
  ) on conflict (package_id, channel, locale) do nothing;

  select * into v_pointer
  from public.product_registration_v5_publication_pointers p
  where p.package_id = v_package_id and p.channel = v_channel and p.locale = v_locale
  for update;
  if v_pointer.tenant_id is distinct from v_tenant_id
    or v_pointer.catalog_product_id is distinct from v_catalog_product_id then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_IDENTITY_MISMATCH';
  end if;
  if v_pointer.pointer_version <> v_expected_pointer_version then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSION_CONFLICT:expected %, actual %',
      v_expected_pointer_version, v_pointer.pointer_version;
  end if;

  v_next_version := v_pointer.pointer_version + 1;
  update public.product_registration_v5_publication_pointers
  set current_revision_id = v_revision_id,
      current_snapshot_id = v_snapshot_id,
      state = 'published',
      pointer_version = v_next_version,
      updated_at = now()
  where package_id = v_package_id and channel = v_channel and locale = v_locale;

  update public.travel_packages
  set canonical_revision_id = v_revision_id,
      canonical_payload_hash = v_revision.payload_hash,
      publication_state = 'published',
      status = 'active',
      package_revision = greatest(package_revision, v_revision.revision_no),
      updated_at = now()
  where id = v_package_id and catalog_product_id = v_catalog_product_id;

  update public.public_package_snapshots
  set status = 'published', published_at = coalesce(published_at, now())
  where id = v_snapshot_id and status in ('candidate', 'approved', 'published');

  insert into public.package_publish_decisions (
    tenant_id, catalog_product_id, package_id, package_revision,
    public_snapshot_id, public_snapshot_hash, publication_state, publishable,
    canonical_revision_id, proof_run_id, policy_version, idempotency_key,
    mobile_proof_ref, decision_source
  ) values (
    v_tenant_id, v_catalog_product_id, v_package_id, v_revision.revision_no,
    v_snapshot_id, v_snapshot_hash, 'published', true,
    v_revision_id, v_proof_run_id, v_policy_version, v_operation_key,
    v_proof_run_id::text, 'registration-kernel-cas'
  );

  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'package_id', v_package_id,
    'revision_id', v_revision_id,
    'snapshot_id', v_snapshot_id,
    'snapshot_hash', v_snapshot_hash,
    'proof_run_id', v_proof_run_id,
    'channel', v_channel,
    'locale', v_locale,
    'pointer_version', v_next_version,
    'publication_state', 'published',
    'outcome', v_outcome,
    'policy_version', v_policy_version
  );

  insert into public.product_registration_v5_publication_outbox (
    tenant_id, catalog_product_id, aggregate_type, aggregate_id,
    event_type, dedupe_key, payload
  ) values (
    v_tenant_id, v_catalog_product_id, 'travel_package', v_package_id,
    'package.publication.pointer_committed', v_operation_key || ':surface-invalidation', v_result
  ) on conflict (dedupe_key) do nothing;

  if v_channel = 'customer' then
    execute $sql$
      insert into internal_product_registration.schedule_revalidation_jobs (
        tenant_id, catalog_product_id, product_revision_id, departure_date,
        checkpoint, due_at, provider_policy_version, operation_key
      )
      select $1, $2, $3, d.departure_date, checkpoint.value,
        greatest(now(), (d.departure_date::timestamp - checkpoint.offset_value)),
        $4,
        concat($3::text, ':', d.departure_date::text, ':', checkpoint.value)
      from internal_product_registration.departure_instances d
      cross join (values
        ('publish'::text, interval '0 days'),
        ('d90'::text, interval '90 days'),
        ('d30'::text, interval '30 days'),
        ('d7'::text, interval '7 days')
      ) as checkpoint(value, offset_value)
      where d.revision_id = $3 and d.tenant_id = $1
      on conflict (tenant_id, operation_key) do nothing
    $sql$ using v_tenant_id, v_catalog_product_id, v_revision_id,
      coalesce(nullif(v_policy_version, ''), 'product-registration-v6-policy-1');
  end if;

  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, package_id, operation_key,
    writer_id, authority_mode, event_type, input_hash, result
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_package_id,
    v_operation_key, 'publication-kernel', v_mode,
    'snapshot.published', v_request_hash, v_result
  ) on conflict (tenant_id, operation_key, event_type) do nothing;

  update public.product_registration_v5_idempotency_ledger
  set status = 'succeeded', response = v_result, completed_at = now()
  where operation_key = v_operation_key;

  return v_result;
end;
$$;

revoke all on function internal_product_registration.publish_snapshot_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.publish_snapshot_atomic(jsonb)
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

  -- Append-only source-scoped eligibility; the inner writer matches the
  -- revision ID and ignores the row after this short window expires.
  insert into internal_product_registration.cohort_quality_metrics (
    tenant_id, supplier_key, parser_version, policy_version,
    window_start, window_end, sample_count, auto_publish_count,
    critical_defect_count, exact_match_rate, publication_eligible, metrics
  ) values (
    v_tenant_id, null, v_parser_version, v_policy_version,
    now(), now() + interval '15 minutes', 1, 1,
    0, null, true,
    jsonb_build_object(
      'mode', 'source_evidence_and_mobile_proof',
      'benchmarkEligible', false,
      'operationKey', v_operation_key,
      'sourceScoped', true,
      'sourceRevisionId', v_revision_id
    )
  );

  v_result := internal_product_registration.publish_snapshot_atomic(p_payload);
  return v_result || jsonb_build_object(
    'eligibility_mode', 'source_evidence_and_mobile_proof'
  );
end;
$$;

revoke all on function public.publish_product_registration_snapshot_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_product_registration_snapshot_atomic(jsonb)
  to service_role;
