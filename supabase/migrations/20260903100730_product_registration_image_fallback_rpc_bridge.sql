-- PostgREST intentionally exposes only public/graphql_public in production.
-- Keep raw registration evidence inside the private schema and expose a
-- service-role-only RPC boundary for the narrowly-scoped ledger operations.

create or replace function public.get_or_create_product_registration_image_fallback_run(
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_run internal_product_registration.image_fallback_runs%rowtype;
  v_reused boolean := false;
begin
  insert into internal_product_registration.image_fallback_runs (
    tenant_id,
    source_document_id,
    source_hash,
    parser_engine,
    parser_version,
    renderer_engine,
    renderer_version,
    render_config_hash,
    key_hash
  ) values (
    (p_payload->>'tenant_id')::uuid,
    (p_payload->>'source_document_id')::uuid,
    p_payload->>'source_hash',
    p_payload->>'parser_engine',
    p_payload->>'parser_version',
    p_payload->>'renderer_engine',
    p_payload->>'renderer_version',
    p_payload->>'render_config_hash',
    p_payload->>'key_hash'
  )
  on conflict do nothing
  returning * into v_run;

  if v_run.id is null then
    v_reused := true;
    select * into v_run
    from internal_product_registration.image_fallback_runs
    where key_hash = p_payload->>'key_hash';
  end if;

  if v_run.id is null then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_RUN_CREATE_FAILED';
  end if;

  if v_run.tenant_id is distinct from (p_payload->>'tenant_id')::uuid
    or v_run.source_document_id is distinct from (p_payload->>'source_document_id')::uuid
    or v_run.source_hash is distinct from p_payload->>'source_hash'
    or v_run.parser_engine is distinct from p_payload->>'parser_engine'
    or v_run.parser_version is distinct from p_payload->>'parser_version'
    or v_run.renderer_engine is distinct from p_payload->>'renderer_engine'
    or v_run.renderer_version is distinct from p_payload->>'renderer_version'
    or v_run.render_config_hash is distinct from p_payload->>'render_config_hash' then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_RUN_KEY_CONFLICT';
  end if;

  return jsonb_build_object('run', to_jsonb(v_run), 'reused', v_reused);
end;
$$;

create or replace function public.get_product_registration_image_fallback_page(
  p_run_id uuid,
  p_page_number integer
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select to_jsonb(page)
  from internal_product_registration.image_fallback_pages page
  where page.run_id = p_run_id
    and page.page_number = p_page_number;
$$;

create or replace function public.put_product_registration_image_fallback_page(
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_page internal_product_registration.image_fallback_pages%rowtype;
begin
  select * into v_page
  from internal_product_registration.image_fallback_pages
  where run_id = (p_payload->>'run_id')::uuid
    and page_number = (p_payload->>'page_number')::integer;

  if v_page.id is null then
    insert into internal_product_registration.image_fallback_pages (
      run_id,
      page_number,
      source_page_hash,
      image_sha256,
      width,
      height,
      render_artifact_ref,
      status
    ) values (
      (p_payload->>'run_id')::uuid,
      (p_payload->>'page_number')::integer,
      p_payload->>'source_page_hash',
      p_payload->>'image_sha256',
      (p_payload->>'width')::integer,
      (p_payload->>'height')::integer,
      p_payload->>'render_artifact_ref',
      p_payload->>'status'
    )
    on conflict do nothing
    returning * into v_page;

    if v_page.id is null then
      select * into v_page
      from internal_product_registration.image_fallback_pages
      where run_id = (p_payload->>'run_id')::uuid
        and page_number = (p_payload->>'page_number')::integer;
    end if;
  end if;

  if v_page.id is null then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_PAGE_CREATE_FAILED';
  end if;

  if v_page.source_page_hash is distinct from p_payload->>'source_page_hash'
    or v_page.image_sha256 is distinct from p_payload->>'image_sha256'
    or v_page.width is distinct from (p_payload->>'width')::integer
    or v_page.height is distinct from (p_payload->>'height')::integer
    or v_page.render_artifact_ref is distinct from p_payload->>'render_artifact_ref'
    or v_page.status is distinct from p_payload->>'status' then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_PAGE_IMMUTABLE_CONFLICT';
  end if;

  return to_jsonb(v_page);
end;
$$;

create or replace function public.get_product_registration_image_fallback_ocr_evidence(
  p_run_id uuid,
  p_page_number integer,
  p_provider text,
  p_provider_model_version text,
  p_ocr_config_hash text
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select to_jsonb(evidence)
    || jsonb_build_object('run_id', page.run_id, 'page_number', page.page_number)
  from internal_product_registration.image_fallback_ocr_evidence evidence
  join internal_product_registration.image_fallback_pages page on page.id = evidence.page_id
  where page.run_id = p_run_id
    and page.page_number = p_page_number
    and evidence.provider = p_provider
    and evidence.provider_model_version = p_provider_model_version
    and evidence.ocr_config_hash = p_ocr_config_hash;
$$;

create or replace function public.append_product_registration_image_fallback_ocr_evidence(
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_page internal_product_registration.image_fallback_pages%rowtype;
  v_evidence internal_product_registration.image_fallback_ocr_evidence%rowtype;
  v_reused boolean := false;
begin
  select * into v_page
  from internal_product_registration.image_fallback_pages
  where run_id = (p_payload->>'run_id')::uuid
    and page_number = (p_payload->>'page_number')::integer;
  if v_page.id is null then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_PAGE_REQUIRED';
  end if;

  select * into v_evidence
  from internal_product_registration.image_fallback_ocr_evidence
  where page_id = v_page.id
    and provider = p_payload->>'provider'
    and provider_model_version = p_payload->>'provider_model_version'
    and ocr_config_hash = p_payload->>'ocr_config_hash';

  if v_evidence.id is null then
    insert into internal_product_registration.image_fallback_ocr_evidence (
      page_id,
      provider,
      provider_model_version,
      ocr_config_hash,
      request_hash,
      response_hash,
      normalized_layout_hash,
      relation_hash,
      critical_token_hash,
      raw_artifact_ref,
      provider_request_id,
      status,
      cost_krw,
      latency_ms
    ) values (
      v_page.id,
      p_payload->>'provider',
      p_payload->>'provider_model_version',
      p_payload->>'ocr_config_hash',
      p_payload->>'request_hash',
      p_payload->>'response_hash',
      p_payload->>'normalized_layout_hash',
      p_payload->>'relation_hash',
      p_payload->>'critical_token_hash',
      null,
      p_payload->>'provider_request_id',
      p_payload->>'status',
      (p_payload->>'cost_krw')::numeric,
      case when p_payload->'latency_ms' = 'null'::jsonb then null
        else (p_payload->>'latency_ms')::integer end
    )
    on conflict do nothing
    returning * into v_evidence;

    if v_evidence.id is null then
      v_reused := true;
      select * into v_evidence
      from internal_product_registration.image_fallback_ocr_evidence
      where page_id = v_page.id
        and provider = p_payload->>'provider'
        and provider_model_version = p_payload->>'provider_model_version'
        and ocr_config_hash = p_payload->>'ocr_config_hash';
    end if;
  else
    v_reused := true;
  end if;

  if v_evidence.id is null then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_OCR_CREATE_FAILED';
  end if;

  if v_evidence.request_hash is distinct from p_payload->>'request_hash'
    or v_evidence.response_hash is distinct from p_payload->>'response_hash'
    or v_evidence.normalized_layout_hash is distinct from p_payload->>'normalized_layout_hash'
    or v_evidence.relation_hash is distinct from p_payload->>'relation_hash'
    or v_evidence.critical_token_hash is distinct from p_payload->>'critical_token_hash'
    or v_evidence.status is distinct from p_payload->>'status' then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_OCR_IMMUTABLE_CONFLICT';
  end if;

  return jsonb_build_object(
    'evidence', to_jsonb(v_evidence)
      || jsonb_build_object('run_id', v_page.run_id, 'page_number', v_page.page_number),
    'reused', v_reused
  );
end;
$$;

create or replace function public.transition_product_registration_image_fallback_run(
  p_run_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_run internal_product_registration.image_fallback_runs%rowtype;
begin
  select * into v_run
  from internal_product_registration.image_fallback_runs
  where id = p_run_id
  for update;
  if v_run.id is null then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_RUN_NOT_FOUND';
  end if;

  if p_status <> v_run.status and not (
    (v_run.status = 'candidate' and p_status in (
      'deterministically_verified', 'human_review_required', 'rejected',
      'source_value_missing', 'superseded'
    ))
    or (v_run.status = 'human_review_required' and p_status in (
      'human_verified', 'rejected', 'source_value_missing', 'superseded'
    ))
    or (v_run.status in (
      'deterministically_verified', 'human_verified', 'rejected', 'source_value_missing'
    ) and p_status = 'superseded')
  ) then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_RUN_INVALID_TRANSITION:%->%', v_run.status, p_status;
  end if;

  update internal_product_registration.image_fallback_runs
  set status = p_status
  where id = p_run_id
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.get_or_create_product_registration_image_fallback_run(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_image_fallback_page(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.put_product_registration_image_fallback_page(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_image_fallback_ocr_evidence(uuid, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function public.append_product_registration_image_fallback_ocr_evidence(jsonb)
  from public, anon, authenticated;
revoke all on function public.transition_product_registration_image_fallback_run(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_or_create_product_registration_image_fallback_run(jsonb)
  to service_role;
grant execute on function public.get_product_registration_image_fallback_page(uuid, integer)
  to service_role;
grant execute on function public.put_product_registration_image_fallback_page(jsonb)
  to service_role;
grant execute on function public.get_product_registration_image_fallback_ocr_evidence(uuid, integer, text, text, text)
  to service_role;
grant execute on function public.append_product_registration_image_fallback_ocr_evidence(jsonb)
  to service_role;
grant execute on function public.transition_product_registration_image_fallback_run(uuid, text)
  to service_role;

comment on function public.get_or_create_product_registration_image_fallback_run(jsonb) is
  'Service-role-only atomic boundary for private image-fallback run lineage.';
comment on function public.put_product_registration_image_fallback_page(jsonb) is
  'Service-role-only append boundary for immutable private rendered-page evidence.';
comment on function public.append_product_registration_image_fallback_ocr_evidence(jsonb) is
  'Service-role-only append boundary for immutable private OCR evidence hashes.';
