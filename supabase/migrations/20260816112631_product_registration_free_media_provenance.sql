-- Free-first, evidence-bound public media contract for the Registration Kernel.
-- Provider discovery is advisory; only service-role RPCs can link a reviewed
-- destination reference asset to an immutable product revision.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-public-media',
  'product-public-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table internal_product_registration.media_assets
  add column if not exists provider text,
  add column if not exists provider_asset_id text,
  add column if not exists source_page_url text,
  add column if not exists photographer_url text,
  add column if not exists license_code text,
  add column if not exists license_snapshot_at timestamptz,
  add column if not exists delivery_mode text not null default 'external_hotlink',
  add column if not exists subject_type text not null default 'destination',
  add column if not exists subject_key text,
  add column if not exists reference_only boolean not null default true,
  add column if not exists quality_score numeric(5,4) not null default 0,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists content_safety_state text not null default 'unchecked',
  add column if not exists relevance_state text not null default 'unchecked',
  add column if not exists last_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_delivery_mode_check'
      and conrelid = 'internal_product_registration.media_assets'::regclass
  ) then
    alter table internal_product_registration.media_assets
      add constraint media_assets_delivery_mode_check
      check (delivery_mode in ('external_hotlink', 'licensed_cache', 'owned_storage'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_subject_type_check'
      and conrelid = 'internal_product_registration.media_assets'::regclass
  ) then
    alter table internal_product_registration.media_assets
      add constraint media_assets_subject_type_check
      check (subject_type in ('product', 'destination', 'hotel', 'golf', 'attraction', 'brand'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_content_safety_state_check'
      and conrelid = 'internal_product_registration.media_assets'::regclass
  ) then
    alter table internal_product_registration.media_assets
      add constraint media_assets_content_safety_state_check
      check (content_safety_state in ('unchecked', 'safe', 'blocked'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_relevance_state_check'
      and conrelid = 'internal_product_registration.media_assets'::regclass
  ) then
    alter table internal_product_registration.media_assets
      add constraint media_assets_relevance_state_check
      check (relevance_state in ('unchecked', 'verified', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_assets_quality_score_check'
      and conrelid = 'internal_product_registration.media_assets'::regclass
  ) then
    alter table internal_product_registration.media_assets
      add constraint media_assets_quality_score_check
      check (quality_score >= 0 and quality_score <= 1);
  end if;
end;
$$;

update internal_product_registration.media_assets
set
  provider = coalesce(provider, nullif(metadata->>'provider', '')),
  provider_asset_id = coalesce(provider_asset_id, nullif(metadata->>'provider_photo_id', ''), nullif(metadata->>'provider_asset_id', '')),
  source_page_url = coalesce(source_page_url, nullif(metadata->>'source_page_url', '')),
  photographer_url = coalesce(photographer_url, nullif(metadata->>'photographer_url', '')),
  subject_type = case when provenance_type = 'destination_reference' then 'destination' else subject_type end,
  reference_only = case
    when provenance_type in ('supplier_product', 'operator_product') then false
    else true
  end,
  license_snapshot_at = coalesce(license_snapshot_at, created_at),
  last_verified_at = coalesce(last_verified_at, created_at)
where provenance_type in ('destination_reference', 'licensed_stock', 'supplier_product', 'operator_product');

create unique index if not exists uq_pr_media_provider_asset
  on internal_product_registration.media_assets(tenant_id, provider, provider_asset_id)
  where provider is not null and provider_asset_id is not null;

create index if not exists idx_pr_media_free_reference_pool
  on internal_product_registration.media_assets(
    tenant_id,
    subject_type,
    subject_key,
    quality_score desc,
    last_verified_at desc
  )
  where reference_only
    and rights_status in ('verified', 'attribution_required')
    and content_safety_state = 'safe'
    and relevance_state = 'verified';

create or replace function public.get_product_registration_reference_media_candidate(
  p_tenant_id uuid,
  p_subject_key text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select to_jsonb(candidate)
  from (
    select
      a.id as asset_id,
      a.external_url,
      a.provider,
      a.provider_asset_id,
      a.source_page_url,
      a.photographer_url,
      a.rights_holder,
      a.license_code,
      a.license_reference,
      a.attribution_text,
      a.subject_type,
      a.subject_key,
      a.reference_only,
      a.quality_score,
      a.width,
      a.height
    from internal_product_registration.media_assets a
    where a.tenant_id = p_tenant_id
      and a.subject_type = 'destination'
      and a.subject_key = lower(btrim(p_subject_key))
      and a.reference_only
      and a.rights_status in ('verified', 'attribution_required')
      and a.content_safety_state = 'safe'
      and a.relevance_state = 'verified'
      and a.external_url is not null
    order by
      case a.provider when 'wikimedia_commons' then 0 when 'pexels' then 1 else 2 end,
      a.quality_score desc,
      a.last_verified_at desc nulls last,
      a.id
    limit 1
  ) candidate;
$$;

create or replace function public.link_product_registration_reference_media(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_existing_asset_id uuid := nullif(p_payload->>'asset_id', '')::uuid;
  v_external_url text := nullif(btrim(p_payload->>'external_url'), '');
  v_sha256 text := nullif(btrim(p_payload->>'sha256'), '');
  v_provider text := lower(nullif(btrim(p_payload->>'provider'), ''));
  v_provider_asset_id text := nullif(btrim(p_payload->>'provider_asset_id'), '');
  v_subject_key text := lower(nullif(btrim(p_payload->>'subject_key'), ''));
  v_license_reference text := nullif(btrim(p_payload->>'license_reference'), '');
  v_license_code text := nullif(btrim(p_payload->>'license_code'), '');
  v_delivery_mode text := coalesce(nullif(btrim(p_payload->>'delivery_mode'), ''), 'external_hotlink');
  v_storage_bucket text := nullif(btrim(p_payload->>'storage_bucket'), '');
  v_storage_path text := nullif(btrim(p_payload->>'storage_path'), '');
  v_rights_status text;
  v_asset_id uuid;
  v_link_id uuid;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null then
    raise exception 'REGISTRATION_MEDIA_LINEAGE_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.product_registration_v5_revisions r
    where r.id = v_revision_id
      and r.tenant_id = v_tenant_id
      and r.catalog_product_id = v_catalog_product_id
  ) then
    raise exception 'REGISTRATION_MEDIA_REVISION_LINEAGE_MISMATCH';
  end if;
  if exists (
    select 1
    from public.public_package_snapshots s
    where s.tenant_id = v_tenant_id
      and s.catalog_product_id = v_catalog_product_id
      and s.canonical_revision_id = v_revision_id
  ) then
    raise exception 'REGISTRATION_MEDIA_REVISION_ALREADY_SNAPSHOTTED';
  end if;

  if v_existing_asset_id is not null then
    select a.id into v_asset_id
    from internal_product_registration.media_assets a
    where a.id = v_existing_asset_id
      and a.tenant_id = v_tenant_id
      and a.subject_type = 'destination'
      and a.subject_key = v_subject_key
      and a.reference_only
      and a.rights_status in ('verified', 'attribution_required')
      and a.content_safety_state = 'safe'
      and a.relevance_state = 'verified';
    if v_asset_id is null then
      raise exception 'REGISTRATION_MEDIA_POOL_ASSET_NOT_ELIGIBLE';
    end if;
  else
    if v_provider not in ('pexels', 'wikimedia_commons') then
      raise exception 'REGISTRATION_MEDIA_PROVIDER_NOT_ALLOWED';
    end if;
    if v_provider_asset_id is null or v_subject_key is null then
      raise exception 'REGISTRATION_MEDIA_PROVIDER_SUBJECT_REQUIRED';
    end if;
    if v_external_url is null or v_external_url !~ '^https://' then
      raise exception 'REGISTRATION_MEDIA_HTTPS_URL_REQUIRED';
    end if;
    if v_sha256 is null or v_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'REGISTRATION_MEDIA_SHA256_INVALID';
    end if;
    if v_license_reference is null or v_license_reference !~ '^https://' then
      raise exception 'REGISTRATION_MEDIA_LICENSE_REQUIRED';
    end if;
    if v_delivery_mode not in ('external_hotlink', 'licensed_cache') then
      raise exception 'REGISTRATION_MEDIA_DELIVERY_MODE_INVALID';
    end if;
    if v_delivery_mode = 'licensed_cache'
      and (v_storage_bucket <> 'product-public-media' or v_storage_path is null) then
      raise exception 'REGISTRATION_MEDIA_LICENSED_CACHE_INVALID';
    end if;

    v_rights_status := case
      when v_provider = 'wikimedia_commons'
        and lower(coalesce(v_license_code, '')) similar to '%(cc0|public domain|pd)%'
        then 'verified'
      else 'attribution_required'
    end;

    insert into internal_product_registration.media_assets (
      tenant_id,
      storage_bucket,
      storage_path,
      external_url,
      media_type,
      provenance_type,
      rights_status,
      rights_holder,
      license_reference,
      attribution_text,
      sha256,
      metadata,
      provider,
      provider_asset_id,
      source_page_url,
      photographer_url,
      license_code,
      license_snapshot_at,
      delivery_mode,
      subject_type,
      subject_key,
      reference_only,
      quality_score,
      width,
      height,
      content_safety_state,
      relevance_state,
      last_verified_at
    ) values (
      v_tenant_id,
      v_storage_bucket,
      v_storage_path,
      v_external_url,
      'image',
      'destination_reference',
      v_rights_status,
      nullif(btrim(p_payload->>'rights_holder'), ''),
      v_license_reference,
      nullif(btrim(p_payload->>'attribution_text'), ''),
      v_sha256,
      coalesce(p_payload->'metadata', '{}'::jsonb),
      v_provider,
      v_provider_asset_id,
      nullif(btrim(p_payload->>'source_page_url'), ''),
      nullif(btrim(p_payload->>'photographer_url'), ''),
      v_license_code,
      now(),
      v_delivery_mode,
      'destination',
      v_subject_key,
      true,
      least(1, greatest(0, coalesce(nullif(p_payload->>'quality_score', '')::numeric, 0))),
      nullif(p_payload->>'width', '')::integer,
      nullif(p_payload->>'height', '')::integer,
      'safe',
      'verified',
      now()
    )
    on conflict (tenant_id, sha256) do update set
      external_url = excluded.external_url,
      storage_bucket = excluded.storage_bucket,
      storage_path = excluded.storage_path,
      delivery_mode = excluded.delivery_mode,
      source_page_url = excluded.source_page_url,
      photographer_url = excluded.photographer_url,
      rights_holder = excluded.rights_holder,
      license_reference = excluded.license_reference,
      attribution_text = excluded.attribution_text,
      license_code = excluded.license_code,
      quality_score = greatest(internal_product_registration.media_assets.quality_score, excluded.quality_score),
      content_safety_state = 'safe',
      relevance_state = 'verified',
      last_verified_at = now()
    returning id into v_asset_id;
  end if;

  insert into internal_product_registration.media_revision_links (
    tenant_id,
    catalog_product_id,
    product_revision_id,
    media_asset_id,
    role,
    customer_label,
    sort_order
  ) values (
    v_tenant_id,
    v_catalog_product_id,
    v_revision_id,
    v_asset_id,
    'hero',
    coalesce(nullif(btrim(p_payload->>'customer_label'), ''), '여행지 참고 이미지 · 실제 일정과 다를 수 있습니다.'),
    0
  )
  on conflict (product_revision_id, media_asset_id, role) do update
    set customer_label = excluded.customer_label
  returning id into v_link_id;

  return jsonb_build_object(
    'asset_id', v_asset_id,
    'link_id', v_link_id,
    'created', v_existing_asset_id is null,
    'reused', v_existing_asset_id is not null
  );
end;
$$;

create or replace function internal_product_registration.get_revision_aggregate(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select jsonb_build_object(
    'revision', jsonb_build_object(
      'id', r.id,
      'tenant_id', r.tenant_id,
      'catalog_product_id', r.catalog_product_id,
      'payload_hash', r.payload_hash,
      'source_hash', (select s.sha256 from public.product_source_documents s where s.id = r.source_document_id),
      'revision_no', r.revision_no,
      'canonical_payload', r.canonical_payload
    ),
    'departures', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.departure_date, d.variant_key)
      from internal_product_registration.departure_instances d
      where d.revision_id = r.id and d.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'transport_segments', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.section_index, t.variant_key, t.sequence_no)
      from internal_product_registration.transport_segments t
      where t.revision_id = r.id and t.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'lodging_stays', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.section_index, l.variant_key, l.day_index)
      from internal_product_registration.lodging_stays l
      where l.revision_id = r.id and l.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'golf_rounds', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.section_index, g.variant_key, g.day_index)
      from internal_product_registration.golf_rounds g
      where g.revision_id = r.id and g.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(to_jsonb(tr) order by tr.terms_type, tr.created_at)
      from internal_product_registration.terms_revisions tr
      where tr.product_revision_id = r.id and tr.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'role', ml.role,
          'customer_label', ml.customer_label,
          'sort_order', ml.sort_order,
          'external_url', a.external_url,
          'storage_bucket', a.storage_bucket,
          'storage_path', a.storage_path,
          'provenance_type', a.provenance_type,
          'rights_status', a.rights_status,
          'rights_holder', a.rights_holder,
          'license_reference', a.license_reference,
          'license_code', a.license_code,
          'attribution_text', a.attribution_text,
          'provider', a.provider,
          'provider_asset_id', a.provider_asset_id,
          'source_page_url', a.source_page_url,
          'photographer_url', a.photographer_url,
          'delivery_mode', a.delivery_mode,
          'subject_type', a.subject_type,
          'subject_key', a.subject_key,
          'reference_only', a.reference_only,
          'quality_score', a.quality_score,
          'width', a.width,
          'height', a.height,
          'metadata', a.metadata
        ) order by ml.sort_order, a.created_at
      )
      from internal_product_registration.media_revision_links ml
      join internal_product_registration.media_assets a
        on a.id = ml.media_asset_id and a.tenant_id = ml.tenant_id
      where ml.product_revision_id = r.id
        and ml.tenant_id = r.tenant_id
        and a.rights_status in ('verified', 'attribution_required')
        and a.content_safety_state <> 'blocked'
        and a.relevance_state <> 'rejected'
    ), '[]'::jsonb)
  )
  from public.product_registration_v5_revisions r
  where r.id = p_revision_id;
$$;

revoke all on function public.get_product_registration_reference_media_candidate(uuid, text) from public, anon, authenticated;
revoke all on function public.link_product_registration_reference_media(jsonb) from public, anon, authenticated;
revoke all on function internal_product_registration.get_revision_aggregate(uuid) from public, anon, authenticated;
grant execute on function public.get_product_registration_reference_media_candidate(uuid, text) to service_role;
grant execute on function public.link_product_registration_reference_media(jsonb) to service_role;
grant execute on function internal_product_registration.get_revision_aggregate(uuid) to service_role;
