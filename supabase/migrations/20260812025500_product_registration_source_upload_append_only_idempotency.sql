-- Keep source lineage append-only while allowing the same source/request to be
-- retried safely. The previous conflict handler attempted to mutate immutable
-- source_blobs/source_document_uploads rows and was rejected by their trigger.

create or replace function internal_product_registration.record_source_upload_event(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_request_key text := nullif(btrim(p_payload->>'request_key'), '');
  v_blob_id uuid;
  v_upload_id uuid;
  v_existing_source_document_id uuid;
  v_source public.product_source_documents%rowtype;
begin
  if v_tenant_id is null or v_source_document_id is null or v_request_key is null then
    raise exception 'REGISTRATION_SOURCE_UPLOAD_LINEAGE_REQUIRED';
  end if;

  select * into v_source
  from public.product_source_documents
  where id = v_source_document_id and tenant_id = v_tenant_id;
  if not found then
    raise exception 'REGISTRATION_SOURCE_UPLOAD_TENANT_MISMATCH';
  end if;

  insert into internal_product_registration.source_blobs (
    tenant_id, sha256, byte_size, storage_bucket, storage_path, detected_mime
  ) values (
    v_tenant_id, v_source.sha256, v_source.byte_size,
    v_source.storage_bucket, v_source.storage_path, v_source.detected_mime
  ) on conflict (tenant_id, sha256, byte_size) do nothing;

  select id into v_blob_id
  from internal_product_registration.source_blobs
  where tenant_id = v_tenant_id
    and sha256 = v_source.sha256
    and byte_size = v_source.byte_size;
  if v_blob_id is null then
    raise exception 'REGISTRATION_SOURCE_BLOB_RESOLUTION_FAILED';
  end if;

  insert into internal_product_registration.source_document_uploads (
    tenant_id, source_blob_id, source_document_id, request_key,
    source_channel, original_filename, metadata
  ) values (
    v_tenant_id, v_blob_id, v_source_document_id, v_request_key,
    coalesce(nullif(p_payload->>'source_channel', ''), 'upload'),
    v_source.original_filename, coalesce(p_payload->'metadata', '{}'::jsonb)
  ) on conflict (tenant_id, request_key) do nothing;

  select id, source_document_id into v_upload_id, v_existing_source_document_id
  from internal_product_registration.source_document_uploads
  where tenant_id = v_tenant_id and request_key = v_request_key;

  if v_upload_id is null then
    raise exception 'REGISTRATION_SOURCE_UPLOAD_RESOLUTION_FAILED';
  end if;
  if v_existing_source_document_id is distinct from v_source_document_id then
    raise exception 'REGISTRATION_SOURCE_UPLOAD_REQUEST_KEY_CONFLICT';
  end if;

  return jsonb_build_object(
    'source_blob_id', v_blob_id,
    'source_document_upload_id', v_upload_id
  );
end;
$$;

revoke all on function internal_product_registration.record_source_upload_event(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.record_source_upload_event(jsonb) to service_role;

comment on function internal_product_registration.record_source_upload_event(jsonb) is
  'Append-only, tenant-scoped, idempotent source upload lineage recorder.';
