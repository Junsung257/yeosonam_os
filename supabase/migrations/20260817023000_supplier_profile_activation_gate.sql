-- Supplier layout profiles are parser hints, never facts. An active profile
-- must be backed by enough independently reviewed evidence before the V6
-- workflow can consume it.

create or replace function public.activate_product_registration_supplier_profile(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_profile internal_product_registration.supplier_layout_profiles%rowtype;
  v_run internal_product_registration.profile_benchmark_runs%rowtype;
  v_section_count integer;
  v_lineage_count integer;
begin
  if coalesce(p_payload->>'profile_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'SUPPLIER_PROFILE_ID_REQUIRED';
  end if;

  select * into v_profile
  from internal_product_registration.supplier_layout_profiles
  where id = (p_payload->>'profile_id')::uuid
  for update;
  if not found then raise exception 'SUPPLIER_PROFILE_NOT_FOUND'; end if;

  select * into v_run
  from internal_product_registration.profile_benchmark_runs
  where supplier_layout_profile_id = v_profile.id
  order by created_at desc
  limit 1;
  if not found then raise exception 'SUPPLIER_PROFILE_BENCHMARK_REQUIRED'; end if;

  v_section_count := coalesce(
    nullif(v_run.metrics->>'sectionCount', '')::integer,
    nullif(v_run.metrics->>'section_count', '')::integer,
    nullif(v_run.metrics->>'sampleCount', '')::integer,
    nullif(v_run.metrics->>'sample_count', '')::integer,
    0
  );
  v_lineage_count := coalesce(
    nullif(v_run.metrics->>'lineageCount', '')::integer,
    nullif(v_run.metrics->>'lineage_count', '')::integer,
    0
  );

  if not v_run.passed
    or v_section_count < 30
    or v_lineage_count < 10
    or v_run.critical_false_publish_count <> 0
    or coalesce(v_run.exact_match_rate, 0) < 0.995 then
    raise exception 'SUPPLIER_PROFILE_BENCHMARK_GATE_FAILED';
  end if;

  -- One active profile per tenant/supplier/document family. Historical rows
  -- remain append-only evidence and move to retired rather than being deleted.
  update internal_product_registration.supplier_layout_profiles
  set activation_state = 'retired'
  where tenant_id = v_profile.tenant_id
    and supplier_key = v_profile.supplier_key
    and document_family = v_profile.document_family
    and activation_state = 'active'
    and id <> v_profile.id;

  update internal_product_registration.supplier_layout_profiles
  set activation_state = 'active', activated_at = now()
  where id = v_profile.id;

  return jsonb_build_object(
    'profileId', v_profile.id,
    'profileHash', v_profile.profile_hash,
    'sectionCount', v_section_count,
    'lineageCount', v_lineage_count,
    'exactMatchRate', v_run.exact_match_rate,
    'activated', true
  );
end;
$$;

revoke all on function public.activate_product_registration_supplier_profile(jsonb)
  from public, anon, authenticated;
grant execute on function public.activate_product_registration_supplier_profile(jsonb)
  to service_role;

