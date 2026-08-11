-- products.status does not accept the registration-workflow label
-- `pending_review`. Keep the compatibility row private with the existing
-- REVIEW_NEEDED lifecycle value until the immutable snapshot is published.
do $migration$
declare
  v_definition text;
  v_legacy_status constant text := '''pending_review''';
  v_current_status constant text := '''REVIEW_NEEDED''';
  v_occurrences integer;
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_legacy_status, ''))
  ) / length(v_legacy_status);

  if v_occurrences = 0 and position(v_current_status in v_definition) > 0 then
    return;
  end if;
  if v_occurrences <> 1 then
    raise exception 'REGISTRATION_COMPATIBILITY_REVIEW_STATUS_CONTRACT_UNKNOWN';
  end if;

  execute replace(v_definition, v_legacy_status, v_current_status);
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

comment on function internal_product_registration.project_compatibility_atomic(jsonb) is
  'Projects a revision into private REVIEW_NEEDED compatibility rows with tenant/source lineage and generated selling-price parity validation.';
