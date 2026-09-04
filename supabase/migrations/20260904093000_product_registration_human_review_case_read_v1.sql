-- PR-V6-05: private case read model for the authenticated review UI.
--
-- The queue RPC intentionally returns only assignment metadata. This second
-- RPC supplies the source IR needed to review a case while keeping the raw
-- document behind the service-role boundary. It never returns a storage path,
-- signed URL, reviewer receipts, or any customer/publication data.

create or replace function public.get_product_registration_review_case(
  p_case_id uuid,
  p_reviewer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_case internal_product_registration.product_review_cases%rowtype;
  v_source record;
  v_extraction record;
  v_reviewer_slot text;
begin
  if p_case_id is null or p_reviewer_id is null then
    raise exception 'PRODUCT_REVIEW_CASE_READ_INPUT_INVALID';
  end if;

  select * into v_case
  from internal_product_registration.product_review_cases c
  where c.id = p_case_id;
  if not found then raise exception 'PRODUCT_REVIEW_CASE_NOT_FOUND'; end if;

  if not exists (
    select 1
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = v_case.tenant_id
      and m.user_id = p_reviewer_id
      and m.is_active
      and m.role in ('tenant_admin', 'tenant_staff')
      and t.status = 'active'
  ) then
    raise exception 'PRODUCT_REVIEW_REVIEWER_MEMBERSHIP_REQUIRED';
  end if;

  select d.id, d.original_filename, d.source_type, d.sha256
    into v_source
  from public.product_source_documents d
  where d.id = v_case.source_document_id
    and d.tenant_id = v_case.tenant_id;
  if not found or v_source.sha256 is distinct from v_case.source_hash then
    raise exception 'PRODUCT_REVIEW_CASE_SOURCE_LINEAGE_MISMATCH';
  end if;

  select e.id, e.extraction_hash, e.document_ir, e.parser_engine, e.parser_version
    into v_extraction
  from public.product_document_extractions e
  where e.id = v_case.parent_extraction_id
    and e.tenant_id = v_case.tenant_id
    and e.source_document_id = v_case.source_document_id;
  if not found or v_extraction.extraction_hash is distinct from v_case.parent_extraction_hash then
    raise exception 'PRODUCT_REVIEW_CASE_EXTRACTION_LINEAGE_MISMATCH';
  end if;

  select case
    when count(*) filter (where r.reviewer_slot = 'first') = 0 then 'first'
    when count(*) filter (where r.reviewer_slot = 'second') = 0 then 'second'
    else 'adjudicator'
  end into v_reviewer_slot
  from internal_product_registration.product_review_receipts r
  where r.case_id = v_case.id;

  return jsonb_build_object(
    'caseId', v_case.id,
    'status', v_case.status,
    'reviewerSlot', v_reviewer_slot,
    'sourceDocument', jsonb_build_object(
      'id', v_source.id,
      'filename', v_source.original_filename,
      'sourceType', v_source.source_type,
      'sourceHash', v_source.sha256
    ),
    'parentExtraction', jsonb_build_object(
      'id', v_extraction.id,
      'extractionHash', v_extraction.extraction_hash,
      'parserEngine', v_extraction.parser_engine,
      'parserVersion', v_extraction.parser_version
    ),
    'sourceText', coalesce(v_extraction.document_ir->>'text', ''),
    'sourceNodes', coalesce(v_extraction.document_ir->'nodes', '[]'::jsonb),
    'sourceTables', coalesce(v_extraction.document_ir->'tables', '[]'::jsonb),
    'packet', v_case.packet,
    'reasonCodes', v_case.reason_codes,
    'createdAt', v_case.created_at
  );
end;
$$;

revoke all on function public.get_product_registration_review_case(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_product_registration_review_case(uuid, uuid) to service_role;

comment on function public.get_product_registration_review_case(uuid, uuid) is
  'Private V6 review read model. Requires active tenant reviewer membership and exact source/extraction lineage; never a publication or customer-read surface.';
