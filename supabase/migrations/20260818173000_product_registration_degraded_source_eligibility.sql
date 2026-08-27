-- Keep the source-proof eligibility gate aligned with the publication kernel:
-- a needs_review revision may enter only the published_degraded path.  The
-- critical claim/evidence and exact mobile-proof checks below remain required,
-- so this does not turn an unresolved critical fact into a public product.
do $migration$
declare
  v_definition text;
  v_old constant text := $old$
    and r.status in ('candidate', 'verified', 'approved', 'published');$old$;
  v_new constant text := $new$
    and (
      r.status in ('candidate', 'verified', 'approved', 'published')
      or (r.status = 'needs_review' and p_payload->>'outcome' = 'published_degraded')
    );$new$;
begin
  select pg_get_functiondef(
    'internal_product_registration.source_proof_auto_eligible(jsonb)'::regprocedure
  ) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'REGISTRATION_DEGRADED_SOURCE_ELIGIBILITY_CONTRACT_UNKNOWN';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

revoke all on function internal_product_registration.source_proof_auto_eligible(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.source_proof_auto_eligible(jsonb)
  to service_role;
