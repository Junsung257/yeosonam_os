-- Bind OCR evidence to one concrete canonical product axis before a rendered
-- page can be marked deterministically verified. Hash agreement alone is not
-- product ownership evidence.

alter table internal_product_registration.image_fallback_pages
  add column if not exists binding_hash text,
  add column if not exists binding_reason text,
  add column if not exists binding_disposition text,
  add column if not exists source_value_state text,
  add column if not exists axis_resolution text,
  add column if not exists axis_binding_hash text,
  add column if not exists axis_key text,
  add column if not exists section_index integer,
  add column if not exists variant_index integer,
  add column if not exists variant_key text;

alter table internal_product_registration.image_fallback_pages
  drop constraint if exists image_fallback_pages_binding_hash_check,
  add constraint image_fallback_pages_binding_hash_check
    check (binding_hash is null or binding_hash ~ '^[0-9a-f]{64}$'),
  drop constraint if exists image_fallback_pages_axis_binding_hash_check,
  add constraint image_fallback_pages_axis_binding_hash_check
    check (axis_binding_hash is null or axis_binding_hash ~ '^[0-9a-f]{64}$'),
  drop constraint if exists image_fallback_pages_binding_disposition_check,
  add constraint image_fallback_pages_binding_disposition_check
    check (binding_disposition is null or binding_disposition in (
      'candidate', 'deterministically_verified', 'human_review_required',
      'human_verified', 'rejected', 'source_value_missing'
    )),
  drop constraint if exists image_fallback_pages_source_value_state_check,
  add constraint image_fallback_pages_source_value_state_check
    check (source_value_state is null or source_value_state in (
      'present', 'missing', 'inquiry', 'sold_out', 'zero'
    )),
  drop constraint if exists image_fallback_pages_axis_resolution_check,
  add constraint image_fallback_pages_axis_resolution_check
    check (axis_resolution is null or axis_resolution in (
      'not_requested', 'unique', 'ambiguous', 'unbound'
    )),
  drop constraint if exists image_fallback_pages_binding_shape_check,
  add constraint image_fallback_pages_binding_shape_check check (
    (binding_hash is null
      and binding_reason is null
      and binding_disposition is null
      and source_value_state is null
      and axis_resolution is null
      and axis_binding_hash is null
      and axis_key is null
      and section_index is null
      and variant_index is null
      and variant_key is null)
    or
    (binding_hash is not null
      and binding_disposition is not null
      and source_value_state is not null
      and axis_resolution is not null
      and (
        (axis_resolution = 'unique'
          and axis_binding_hash is not null
          and nullif(btrim(axis_key), '') is not null
          and section_index >= 0
          and variant_index >= 0)
        or
        (axis_resolution <> 'unique'
          and axis_binding_hash is null
          and axis_key is null
          and section_index is null
          and variant_index is null
          and variant_key is null)
      ))
  ),
  drop constraint if exists image_fallback_pages_verified_axis_check,
  add constraint image_fallback_pages_verified_axis_check check (
    status <> 'deterministically_verified'
    or (
      binding_disposition = 'candidate'
      and source_value_state = 'present'
      and axis_resolution = 'unique'
      and axis_binding_hash is not null
    )
  );

comment on column internal_product_registration.image_fallback_pages.binding_hash is
  'Hash of source-cell facts plus the complete canonical product-axis candidate set.';
comment on column internal_product_registration.image_fallback_pages.axis_binding_hash is
  'Hash of the unique axisKey/sectionIndex/variantIndex/variantKey owner.';

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
      status,
      binding_hash,
      binding_reason,
      binding_disposition,
      source_value_state,
      axis_resolution,
      axis_binding_hash,
      axis_key,
      section_index,
      variant_index,
      variant_key
    ) values (
      (p_payload->>'run_id')::uuid,
      (p_payload->>'page_number')::integer,
      p_payload->>'source_page_hash',
      p_payload->>'image_sha256',
      (p_payload->>'width')::integer,
      (p_payload->>'height')::integer,
      p_payload->>'render_artifact_ref',
      p_payload->>'status',
      p_payload->>'binding_hash',
      p_payload->>'binding_reason',
      p_payload->>'binding_disposition',
      p_payload->>'source_value_state',
      p_payload->>'axis_resolution',
      p_payload->>'axis_binding_hash',
      p_payload->>'axis_key',
      case when p_payload->>'section_index' is null then null
        else (p_payload->>'section_index')::integer end,
      case when p_payload->>'variant_index' is null then null
        else (p_payload->>'variant_index')::integer end,
      p_payload->>'variant_key'
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
    or v_page.status is distinct from p_payload->>'status'
    or v_page.binding_hash is distinct from p_payload->>'binding_hash'
    or v_page.binding_reason is distinct from p_payload->>'binding_reason'
    or v_page.binding_disposition is distinct from p_payload->>'binding_disposition'
    or v_page.source_value_state is distinct from p_payload->>'source_value_state'
    or v_page.axis_resolution is distinct from p_payload->>'axis_resolution'
    or v_page.axis_binding_hash is distinct from p_payload->>'axis_binding_hash'
    or v_page.axis_key is distinct from p_payload->>'axis_key'
    or v_page.section_index is distinct from (case when p_payload->>'section_index' is null then null
      else (p_payload->>'section_index')::integer end)
    or v_page.variant_index is distinct from (case when p_payload->>'variant_index' is null then null
      else (p_payload->>'variant_index')::integer end)
    or v_page.variant_key is distinct from p_payload->>'variant_key' then
    raise exception 'IMAGE_FALLBACK_EVIDENCE_PAGE_IMMUTABLE_CONFLICT';
  end if;

  return to_jsonb(v_page);
end;
$$;

revoke all on function public.put_product_registration_image_fallback_page(jsonb)
  from public, anon, authenticated;
grant execute on function public.put_product_registration_image_fallback_page(jsonb)
  to service_role;
