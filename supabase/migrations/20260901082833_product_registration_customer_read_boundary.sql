-- Keep new publication closed while customer-read and evidence convergence are
-- repaired. Existing published pointers remain untouched and readable.
update internal_product_registration.registration_authority_config
set publication_freeze = true,
    updated_at = now()
where singleton = true;

create or replace function internal_product_registration.resolve_customer_route_state_v2(
  p_tenant_id uuid,
  p_route_ref text,
  p_channel text default 'customer',
  p_locale text default 'ko-KR'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_route_ref text := nullif(btrim(p_route_ref), '');
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_sale_state text;
begin
  if p_tenant_id is null or v_route_ref is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;
  if p_channel not in ('customer', 'b2b', 'partner') or nullif(btrim(p_locale), '') is null then
    return jsonb_build_object('state', 'UNAVAILABLE');
  end if;

  select pointer.* into v_pointer
  from public.product_registration_v5_publication_pointers pointer
  join public.travel_packages package on package.id = pointer.package_id
  where pointer.tenant_id = p_tenant_id
    and pointer.channel = p_channel
    and pointer.locale = p_locale
    and (
      pointer.package_id::text = v_route_ref
      or lower(coalesce(package.short_code, '')) = lower(v_route_ref)
    )
  order by pointer.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;
  if v_pointer.state <> 'published'
    or v_pointer.current_revision_id is null
    or v_pointer.current_snapshot_id is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  if not exists (
    select 1
    from public.product_registration_v5_revisions revision
    join public.public_package_snapshots snapshot
      on snapshot.id = v_pointer.current_snapshot_id
     and snapshot.tenant_id = v_pointer.tenant_id
     and snapshot.catalog_product_id = v_pointer.catalog_product_id
     and snapshot.package_id = v_pointer.package_id
     and snapshot.canonical_revision_id = v_pointer.current_revision_id
     and snapshot.status = 'published'
    where revision.id = v_pointer.current_revision_id
      and revision.tenant_id = v_pointer.tenant_id
      and revision.catalog_product_id = v_pointer.catalog_product_id
      and revision.status in ('verified', 'approved', 'published')
  ) then
    return jsonb_build_object('state', 'UNAVAILABLE');
  end if;

  select overlay.sale_state into v_sale_state
  from internal_product_registration.package_availability_overlays overlay
  where overlay.tenant_id = v_pointer.tenant_id
    and overlay.catalog_product_id = v_pointer.catalog_product_id
    and overlay.channel = p_channel
    and (overlay.expires_at is null or overlay.expires_at > now())
  order by overlay.updated_at desc
  limit 1;

  if coalesce(v_sale_state, 'available') in ('closed', 'sold_out', 'suspended') then
    return jsonb_build_object(
      'state', 'SALE_UNAVAILABLE',
      'package_id', v_pointer.package_id,
      'catalog_product_id', v_pointer.catalog_product_id,
      'pointer_version', v_pointer.pointer_version
    );
  end if;

  return jsonb_build_object(
    'state', 'PUBLIC',
    'package_id', v_pointer.package_id,
    'catalog_product_id', v_pointer.catalog_product_id,
    'revision_id', v_pointer.current_revision_id,
    'snapshot_id', v_pointer.current_snapshot_id,
    'pointer_version', v_pointer.pointer_version
  );
end;
$$;

create or replace function public.get_product_registration_customer_route_state(
  p_tenant_id uuid,
  p_route_ref text,
  p_channel text default 'customer',
  p_locale text default 'ko-KR'
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.resolve_customer_route_state_v2(
    p_tenant_id,
    p_route_ref,
    p_channel,
    p_locale
  );
$$;

create or replace function internal_product_registration.resolve_qualified_supplier_profile(
  p_tenant_id uuid,
  p_supplier_key text,
  p_document_family text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_profile internal_product_registration.supplier_layout_profiles%rowtype;
  v_run internal_product_registration.profile_benchmark_runs%rowtype;
begin
  if p_tenant_id is null
    or nullif(btrim(p_supplier_key), '') is null
    or nullif(btrim(p_document_family), '') is null then
    return null;
  end if;

  select profile.* into v_profile
  from internal_product_registration.supplier_layout_profiles profile
  where profile.tenant_id = p_tenant_id
    and profile.supplier_key = p_supplier_key
    and profile.document_family = p_document_family
    and profile.activation_state = 'active'
  order by profile.activated_at desc nulls last, profile.created_at desc
  limit 1;
  if not found then return null; end if;

  select run.* into v_run
  from internal_product_registration.profile_benchmark_runs run
  where run.tenant_id = p_tenant_id
    and run.supplier_layout_profile_id = v_profile.id
  order by run.created_at desc
  limit 1;

  return jsonb_build_object(
    'id', v_profile.id,
    'supplier_key', v_profile.supplier_key,
    'document_family', v_profile.document_family,
    'profile_version', v_profile.profile_version,
    'profile_hash', v_profile.profile_hash,
    'segmentation_rules', v_profile.segmentation_rules,
    'benchmark', case when v_run.id is null then null else jsonb_build_object(
      'passed', v_run.passed,
      'metrics', v_run.metrics,
      'critical_false_publish_count', v_run.critical_false_publish_count,
      'exact_match_rate', v_run.exact_match_rate,
      'created_at', v_run.created_at
    ) end
  );
end;
$$;

create or replace function public.get_qualified_product_registration_supplier_profile(
  p_tenant_id uuid,
  p_supplier_key text,
  p_document_family text
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.resolve_qualified_supplier_profile(
    p_tenant_id,
    p_supplier_key,
    p_document_family
  );
$$;

revoke all on function internal_product_registration.resolve_customer_route_state_v2(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_customer_route_state(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function internal_product_registration.resolve_qualified_supplier_profile(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_qualified_product_registration_supplier_profile(uuid, text, text)
  from public, anon, authenticated;

grant usage on schema internal_product_registration to service_role;
grant execute on function internal_product_registration.resolve_customer_route_state_v2(uuid, text, text, text)
  to service_role;
grant execute on function public.get_product_registration_customer_route_state(uuid, text, text, text)
  to service_role;
grant execute on function internal_product_registration.resolve_qualified_supplier_profile(uuid, text, text)
  to service_role;
grant execute on function public.get_qualified_product_registration_supplier_profile(uuid, text, text)
  to service_role;

comment on function public.get_product_registration_customer_route_state(uuid, text, text, text) is
  'Service-role-only minimal customer route preflight. Returns identity/state only; never snapshot payload or hashes.';
comment on function public.get_qualified_product_registration_supplier_profile(uuid, text, text) is
  'Service-role-only read boundary for qualified supplier layout profiles in the non-exposed internal schema.';
