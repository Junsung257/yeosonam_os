-- travel_packages.id is UUID. PostgreSQL does not provide min(uuid), so
-- select the single tenant-scoped compatibility identity through a stable
-- text ordering after the ambiguity count has been computed.
do $migration$
declare
  v_definition text;
  v_legacy_select constant text :=
    'select count(*), min(id) into v_count, v_package_id
  from public.travel_packages';
  v_current_select constant text :=
    'select count(*), min(id::text)::uuid into v_count, v_package_id
  from public.travel_packages';
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_legacy_select in v_definition) = 0
    and position(v_current_select in v_definition) > 0 then
    return;
  end if;
  if position(v_legacy_select in v_definition) = 0 then
    raise exception 'REGISTRATION_COMPATIBILITY_UUID_IDENTITY_CONTRACT_UNKNOWN';
  end if;

  execute replace(v_definition, v_legacy_select, v_current_select);
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

comment on function internal_product_registration.project_compatibility_atomic(jsonb) is
  'Projects a revision into private REVIEW_NEEDED compatibility rows with UUID-safe identity, tenant/source lineage, and generated selling-price parity validation.';
