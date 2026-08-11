-- V5 is the authoritative customer artifact. Keep the legacy package row
-- coherent after the proof-bound CAS pointer is published so older list/search
-- projections do not hide an already-approved immutable snapshot.
do $$
declare
  v_function_definition text;
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
  if position('publication_state = p_publication_state,' in v_function_definition) = 0 then
    raise exception 'V5_PUBLICATION_RPC_UPDATE_NOT_FOUND';
  end if;

  execute replace(
    v_function_definition,
    'publication_state = p_publication_state,',
    'publication_state = p_publication_state,' || chr(10)
      || '      audit_status = case when p_publication_state = ''published'' then ''clean'' else audit_status end,'
  );
end;
$$;
