-- Fail closed for direct service-role CAS calls as well as the admin preflight.
-- An unbound shadow witness is evidence only; it cannot become current for a
-- package that was created later.

do $$
declare
  v_function_definition text;
  v_old_predicate text := 'and (package_id is null or package_id = p_package_id)';
begin
  select pg_get_functiondef(p.oid)
    into v_function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'publish_product_registration_v5_snapshot_atomic'
    and p.pronargs = 12;

  if v_function_definition is null then
    raise exception 'V5_PUBLICATION_RPC_NOT_FOUND';
  end if;
  if position(v_old_predicate in v_function_definition) = 0 then
    raise exception 'V5_PUBLICATION_RPC_PREDICATE_NOT_FOUND';
  end if;

  execute replace(v_function_definition, v_old_predicate, 'and package_id = p_package_id');
end;
$$;
