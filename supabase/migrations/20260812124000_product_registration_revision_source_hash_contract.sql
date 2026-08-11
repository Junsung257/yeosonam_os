-- product_registration_v5_revisions stores source_document_id, not a
-- duplicated source_hash column. Keep compatibility projection lineage
-- fail-closed by validating the requested hash against the tenant-scoped
-- source document referenced by the immutable revision.
do $migration$
declare
  v_definition text;
  v_legacy_fragment constant text :=
    'and r.source_hash = p_payload->>''source_hash''';
  v_source_document_fragment constant text :=
    'and exists (
      select 1
      from public.product_source_documents source_document
      where source_document.id = r.source_document_id
        and source_document.tenant_id = r.tenant_id
        and source_document.sha256 = p_payload->>''source_hash''
    )';
begin
  select pg_get_functiondef(
    'internal_product_registration.project_compatibility_atomic(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_source_document_fragment in v_definition) > 0 then
    return;
  end if;
  if position(v_legacy_fragment in v_definition) = 0 then
    raise exception 'REGISTRATION_COMPATIBILITY_SOURCE_HASH_CONTRACT_UNKNOWN';
  end if;

  execute replace(v_definition, v_legacy_fragment, v_source_document_fragment);
end;
$migration$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb)
  to service_role;

comment on function internal_product_registration.project_compatibility_atomic(jsonb) is
  'Projects a revision into legacy compatibility rows after validating revision, tenant, catalog, payload hash, and source-document SHA-256 lineage.';
