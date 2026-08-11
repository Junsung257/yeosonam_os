-- Canonical typed facts are immutable and already identify their stable
-- product through catalog_product_id + revision_id. A legacy compatibility
-- package UUID is not authoritative and must not be backfilled with UPDATE.
do $migration$
declare
  v_definition text;
  v_legacy_updates constant text :=
    '  update internal_product_registration.departure_instances
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.transport_segments
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.lodging_stays
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.golf_rounds
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;

';
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_legacy_updates in v_definition) = 0
    and position('update internal_product_registration.departure_instances' in v_definition) = 0 then
    return;
  end if;
  if position(v_legacy_updates in v_definition) = 0 then
    raise exception 'REGISTRATION_COMPATIBILITY_TYPED_IMMUTABILITY_CONTRACT_UNKNOWN';
  end if;

  execute replace(v_definition, v_legacy_updates, '');
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

comment on function internal_product_registration.project_compatibility_atomic(jsonb) is
  'Projects a revision into private REVIEW_NEEDED compatibility rows without mutating immutable typed revision facts.';
