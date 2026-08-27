-- Open individually proven products while the broad cohort remains in shadow.
-- The source-proof feature already verifies immutable revision lineage,
-- critical claim evidence, and both mobile customer surfaces. Before this
-- migration the application could opt into that path, but the database still
-- rejected it on the global freeze and shadow-authority checks.

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'internal_product_registration.publish_snapshot_atomic(jsonb)'::regprocedure
  ) into v_definition;

  if position('v_source_proof_mode boolean' in v_definition) = 0 then
    v_old := $old$  v_freeze boolean;
  v_supplier text;$old$;
    v_new := $new$  v_freeze boolean;
  v_source_proof_mode boolean := false;
  v_supplier text;$new$;
    if position(v_old in v_definition) = 0 then
      raise exception 'REGISTRATION_SOURCE_PROOF_INNER_DECLARATION_CONTRACT_UNKNOWN';
    end if;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $old$  select authority_mode, publication_freeze into v_mode, v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;
  if v_mode <> 'kernel' then raise exception 'REGISTRATION_PUBLICATION_KERNEL_AUTHORITY_REQUIRED'; end if;
  if v_freeze then raise exception 'REGISTRATION_PUBLICATION_FROZEN'; end if;$old$;
    v_new := $new$  select authority_mode, publication_freeze into v_mode, v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;
  v_source_proof_mode := coalesce(current_setting('app.product_registration_source_proof', true), 'false') = 'true'
    and p_payload->>'source_proof_auto_publish' = 'true';
  if v_mode <> 'kernel' and not (v_mode = 'shadow' and v_source_proof_mode) then
    raise exception 'REGISTRATION_PUBLICATION_KERNEL_AUTHORITY_REQUIRED';
  end if;
  if v_freeze and not v_source_proof_mode then
    raise exception 'REGISTRATION_PUBLICATION_FROZEN';
  end if;$new$;
    if position(v_old in v_definition) = 0 then
      raise exception 'REGISTRATION_SOURCE_PROOF_AUTHORITY_CONTRACT_UNKNOWN';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
    execute v_definition;
  end if;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.publish_product_registration_snapshot_atomic(jsonb)'::regprocedure
  ) into v_definition;
  v_old := $old$  v_result := internal_product_registration.publish_snapshot_atomic(p_payload);
  return v_result || jsonb_build_object($old$;
  v_new := $new$  perform set_config('app.product_registration_source_proof', 'true', true);
  v_result := internal_product_registration.publish_snapshot_atomic(p_payload);
  return v_result || jsonb_build_object($new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'REGISTRATION_SOURCE_PROOF_WRAPPER_CONTRACT_UNKNOWN';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'internal_product_registration.assert_publication_not_frozen()'::regprocedure
  ) into v_definition;
  v_old := $old$  if coalesce(v_freeze, true) is false then return new; end if;$old$;
  v_new := $new$  if coalesce(v_freeze, true) is false
    or coalesce(current_setting('app.product_registration_source_proof', true), 'false') = 'true'
  then
    return new;
  end if;$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'REGISTRATION_SOURCE_PROOF_FREEZE_TRIGGER_CONTRACT_UNKNOWN';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

comment on function public.publish_product_registration_snapshot_atomic(jsonb) is
  'CAS publication; source-proof payloads may publish individually verified products during shadow/freeze, while ordinary writes remain frozen.';
