-- Product registration/public catalog publication guardrails.
--
-- Forward-only: the V6.1 authority remains the SSOT. This migration freezes
-- broad publication, records explicit publication requests, fences every
-- published pointer to the latest immutable revision, and gives admin/customer
-- readers one fail-closed truth contract.

update internal_product_registration.registration_authority_config
set publication_freeze = true,
    contract_version = 'product-registration-authority-2-publication-requests',
    updated_at = now()
where singleton = true;

create table if not exists internal_product_registration.publication_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  package_id uuid not null references public.travel_packages(id) on delete restrict,
  expected_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  expected_revision_no bigint not null check (expected_revision_no > 0),
  expected_source_hash text not null check (expected_source_hash ~ '^[0-9a-f]{64}$'),
  expected_pointer_versions jsonb not null check (jsonb_typeof(expected_pointer_versions) = 'object'),
  channels text[] not null default array['customer']::text[],
  locale text not null default 'ko-KR' check (btrim(locale) <> ''),
  source_review_decision_id uuid,
  snapshot_id uuid references public.public_package_snapshots(id) on delete restrict,
  proof_id uuid references public.product_registration_v5_proof_runs(id) on delete restrict,
  release_manifest_hash text check (release_manifest_hash is null or release_manifest_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  requested_by uuid references auth.users(id) on delete set null,
  requested_actor text not null check (btrim(requested_actor) <> ''),
  request_reason text not null check (btrim(request_reason) <> ''),
  status text not null default 'requested' check (status in (
    'requested',
    'revalidating',
    'proving',
    'ready',
    'pointer_committed',
    'published_verified',
    'convergence_failed',
    'rejected',
    'superseded',
    'blocked'
  )),
  error_code text,
  error_detail text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key),
  check (cardinality(channels) between 1 and 3),
  check (channels <@ array['customer', 'b2b', 'partner']::text[])
);

create index if not exists idx_pr_publication_requests_queue
  on internal_product_registration.publication_requests(status, requested_at)
  where status in ('requested', 'revalidating', 'proving', 'ready', 'pointer_committed');

create index if not exists idx_pr_publication_requests_product
  on internal_product_registration.publication_requests(
    tenant_id, catalog_product_id, requested_at desc
  );

alter table internal_product_registration.publication_requests enable row level security;
revoke all on table internal_product_registration.publication_requests
  from public, anon, authenticated;
grant select, insert, update on table internal_product_registration.publication_requests
  to service_role;

create or replace function internal_product_registration.request_publication(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_expected_revision_id uuid := nullif(p_payload->>'expected_revision_id', '')::uuid;
  v_expected_revision_no bigint := nullif(p_payload->>'expected_revision_no', '')::bigint;
  v_expected_source_hash text := nullif(p_payload->>'expected_source_hash', '');
  v_source_review_decision_id uuid := nullif(p_payload->>'source_review_decision_id', '')::uuid;
  v_idempotency_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_requested_actor text := nullif(btrim(p_payload->>'requested_actor'), '');
  v_request_reason text := nullif(btrim(p_payload->>'request_reason'), '');
  v_locale text := coalesce(nullif(btrim(p_payload->>'locale'), ''), 'ko-KR');
  v_channels text[];
  v_channel text;
  v_expected_pointer_versions jsonb := coalesce(p_payload->'expected_pointer_versions', '{}'::jsonb);
  v_expected_pointer_version bigint;
  v_actual_pointer_version bigint;
  v_latest_revision public.product_registration_v5_revisions%rowtype;
  v_request_hash text;
  v_request internal_product_registration.publication_requests%rowtype;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null
    or v_expected_revision_id is null or v_expected_revision_no is null
    or coalesce(v_expected_source_hash, '') !~ '^[0-9a-f]{64}$'
    or v_idempotency_key is null or v_requested_actor is null or v_request_reason is null then
    raise exception 'REGISTRATION_PUBLICATION_REQUEST_INPUT_REQUIRED';
  end if;
  if jsonb_typeof(v_expected_pointer_versions) <> 'object' then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSIONS_REQUIRED';
  end if;

  select array_agg(channel_value order by channel_value)
  into v_channels
  from (
    select distinct jsonb_array_elements_text(
      coalesce(p_payload->'channels', '["customer"]'::jsonb)
    ) as channel_value
  ) channels;

  if coalesce(cardinality(v_channels), 0) = 0
    or cardinality(v_channels) > 3
    or not (v_channels <@ array['customer', 'b2b', 'partner']::text[]) then
    raise exception 'REGISTRATION_PUBLICATION_CHANNELS_INVALID';
  end if;

  select revision.* into v_latest_revision
  from public.product_registration_v5_revisions revision
  where revision.tenant_id = v_tenant_id
    and revision.catalog_product_id = v_catalog_product_id
  order by revision.revision_no desc, revision.created_at desc
  limit 1
  for share;

  if not found
    or v_latest_revision.id is distinct from v_expected_revision_id
    or v_latest_revision.revision_no is distinct from v_expected_revision_no then
    raise exception 'REVISION_CHANGED_REVALIDATION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.product_source_documents source_document
    where source_document.id = v_latest_revision.source_document_id
      and source_document.tenant_id = v_tenant_id
      and source_document.sha256 = v_expected_source_hash
  ) then
    raise exception 'REGISTRATION_PUBLICATION_SOURCE_HASH_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.travel_packages package
    where package.id = v_package_id
      and package.tenant_id = v_tenant_id
      and package.catalog_product_id = v_catalog_product_id
      and package.canonical_revision_id = v_expected_revision_id
  ) then
    raise exception 'REGISTRATION_PUBLICATION_COMPATIBILITY_BINDING_MISMATCH';
  end if;

  foreach v_channel in array v_channels loop
    v_expected_pointer_version := nullif(v_expected_pointer_versions->>v_channel, '')::bigint;
    if v_expected_pointer_version is null or v_expected_pointer_version < 0 then
      raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSION_REQUIRED:%', v_channel;
    end if;
    select pointer.pointer_version into v_actual_pointer_version
    from public.product_registration_v5_publication_pointers pointer
    where pointer.tenant_id = v_tenant_id
      and pointer.catalog_product_id = v_catalog_product_id
      and pointer.package_id = v_package_id
      and pointer.channel = v_channel
      and pointer.locale = v_locale
    for share;
    if found and v_actual_pointer_version is distinct from v_expected_pointer_version then
      raise exception 'REGISTRATION_PUBLICATION_POINTER_CONFLICT:%', v_channel;
    end if;
    if not found and v_expected_pointer_version <> 0 then
      raise exception 'REGISTRATION_PUBLICATION_POINTER_CONFLICT:%', v_channel;
    end if;
  end loop;

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'tenantId', v_tenant_id,
        'catalogProductId', v_catalog_product_id,
        'packageId', v_package_id,
        'expectedRevisionId', v_expected_revision_id,
        'expectedRevisionNo', v_expected_revision_no,
        'expectedSourceHash', v_expected_source_hash,
        'expectedPointerVersions', v_expected_pointer_versions,
        'channels', to_jsonb(v_channels),
        'locale', v_locale,
        'sourceReviewDecisionId', v_source_review_decision_id
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select request.* into v_request
  from internal_product_registration.publication_requests request
  where request.tenant_id = v_tenant_id
    and request.idempotency_key = v_idempotency_key
  for share;

  if found then
    if v_request.request_hash is distinct from v_request_hash then
      raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'request_hash', v_request.request_hash,
      'replayed', true
    );
  end if;

  insert into internal_product_registration.publication_requests (
    tenant_id,
    catalog_product_id,
    package_id,
    expected_revision_id,
    expected_revision_no,
    expected_source_hash,
    expected_pointer_versions,
    channels,
    locale,
    source_review_decision_id,
    request_hash,
    idempotency_key,
    requested_by,
    requested_actor,
    request_reason
  ) values (
    v_tenant_id,
    v_catalog_product_id,
    v_package_id,
    v_expected_revision_id,
    v_expected_revision_no,
    v_expected_source_hash,
    v_expected_pointer_versions,
    v_channels,
    v_locale,
    v_source_review_decision_id,
    v_request_hash,
    v_idempotency_key,
    nullif(p_payload->>'requested_by', '')::uuid,
    v_requested_actor,
    v_request_reason
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning * into v_request;

  if not found then
    select request.* into v_request
    from internal_product_registration.publication_requests request
    where request.tenant_id = v_tenant_id
      and request.idempotency_key = v_idempotency_key
    for share;
    if not found or v_request.request_hash is distinct from v_request_hash then
      raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'request_id', v_request.id,
      'status', v_request.status,
      'request_hash', v_request.request_hash,
      'replayed', true
    );
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'request_hash', v_request.request_hash,
    'replayed', false
  );
end;
$$;

create or replace function public.request_product_registration_publication(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.request_publication(p_payload);
$$;

revoke all on function internal_product_registration.request_publication(jsonb)
  from public, anon, authenticated;
revoke all on function public.request_product_registration_publication(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.request_publication(jsonb)
  to service_role;
grant execute on function public.request_product_registration_publication(jsonb)
  to service_role;

create or replace function internal_product_registration.assert_pointer_latest_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_latest_revision_id uuid;
begin
  if new.state <> 'published' then return new; end if;
  if new.tenant_id is null or new.catalog_product_id is null
    or new.current_revision_id is null or new.current_snapshot_id is null then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_LINEAGE_REQUIRED';
  end if;

  select revision.id into v_latest_revision_id
  from public.product_registration_v5_revisions revision
  where revision.tenant_id = new.tenant_id
    and revision.catalog_product_id = new.catalog_product_id
  order by revision.revision_no desc, revision.created_at desc
  limit 1
  for share;

  if v_latest_revision_id is null
    or v_latest_revision_id is distinct from new.current_revision_id then
    raise exception 'REVISION_CHANGED_REVALIDATION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.travel_packages package
    where package.id = new.package_id
      and package.tenant_id = new.tenant_id
      and package.catalog_product_id = new.catalog_product_id
      and package.canonical_revision_id = new.current_revision_id
  ) then
    raise exception 'REGISTRATION_PUBLICATION_COMPATIBILITY_BINDING_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.public_package_snapshots snapshot
    where snapshot.id = new.current_snapshot_id
      and snapshot.tenant_id = new.tenant_id
      and snapshot.package_id = new.package_id
      and snapshot.catalog_product_id = new.catalog_product_id
      and snapshot.canonical_revision_id = new.current_revision_id
      and snapshot.status = 'published'
  ) then
    raise exception 'REGISTRATION_PUBLICATION_SNAPSHOT_NOT_PUBLISHED';
  end if;

  if not exists (
    select 1
    from public.product_registration_v5_proof_runs proof
    where proof.tenant_id = new.tenant_id
      and proof.catalog_product_id = new.catalog_product_id
      and proof.package_id = new.package_id
      and proof.revision_id = new.current_revision_id
      and proof.public_snapshot_id = new.current_snapshot_id
      and proof.status = 'passed'
  ) then
    raise exception 'REGISTRATION_PUBLICATION_PROOF_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function internal_product_registration.assert_pointer_latest_revision()
  from public, anon, authenticated;
grant execute on function internal_product_registration.assert_pointer_latest_revision()
  to service_role;

drop trigger if exists trg_registration_pointer_latest_revision
  on public.product_registration_v5_publication_pointers;
create trigger trg_registration_pointer_latest_revision
before insert or update of tenant_id, catalog_product_id, package_id,
  current_revision_id, current_snapshot_id, state
on public.product_registration_v5_publication_pointers
for each row execute function internal_product_registration.assert_pointer_latest_revision();

create or replace function internal_product_registration.resolve_customer_route_state(
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
  v_route jsonb;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_visibility text := 'public';
  v_sale_state text := 'available';
  v_latest_revision_id uuid;
begin
  if p_tenant_id is null or nullif(btrim(p_route_ref), '') is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  v_route := internal_product_registration.resolve_public_route(
    p_tenant_id, p_route_ref, p_channel, p_locale
  );
  if v_route is null then return jsonb_build_object('state', 'NOT_FOUND'); end if;

  select pointer.* into v_pointer
  from public.product_registration_v5_publication_pointers pointer
  where pointer.tenant_id = p_tenant_id
    and pointer.catalog_product_id = nullif(v_route->>'catalog_product_id', '')::uuid
    and pointer.channel = p_channel
    and pointer.locale = p_locale
  limit 1;

  if not found or v_pointer.state <> 'published'
    or v_pointer.current_revision_id is null or v_pointer.current_snapshot_id is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  select revision.id into v_latest_revision_id
  from public.product_registration_v5_revisions revision
  where revision.tenant_id = v_pointer.tenant_id
    and revision.catalog_product_id = v_pointer.catalog_product_id
  order by revision.revision_no desc, revision.created_at desc
  limit 1;

  if v_latest_revision_id is distinct from v_pointer.current_revision_id then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  if not exists (
    select 1
    from public.public_package_snapshots snapshot
    where snapshot.id = v_pointer.current_snapshot_id
      and snapshot.tenant_id = v_pointer.tenant_id
      and snapshot.package_id = v_pointer.package_id
      and snapshot.catalog_product_id = v_pointer.catalog_product_id
      and snapshot.canonical_revision_id = v_pointer.current_revision_id
      and snapshot.status = 'published'
  ) or not exists (
    select 1
    from public.product_registration_v5_proof_runs proof
    where proof.tenant_id = v_pointer.tenant_id
      and proof.catalog_product_id = v_pointer.catalog_product_id
      and proof.package_id = v_pointer.package_id
      and proof.revision_id = v_pointer.current_revision_id
      and proof.public_snapshot_id = v_pointer.current_snapshot_id
      and proof.status = 'passed'
  ) then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  select overlay.customer_visibility_state, overlay.sale_state
  into v_visibility, v_sale_state
  from internal_product_registration.package_availability_overlays overlay
  where overlay.tenant_id = p_tenant_id
    and overlay.catalog_product_id = v_pointer.catalog_product_id
    and overlay.channel = p_channel
    and (overlay.expires_at is null or overlay.expires_at > now());

  if coalesce(v_visibility, 'public') = 'under_review' then
    return jsonb_build_object(
      'state', 'UNDER_REVIEW',
      'catalog_product_id', v_pointer.catalog_product_id,
      'package_id', v_pointer.package_id,
      'pointer_version', v_pointer.pointer_version
    );
  end if;
  if coalesce(v_visibility, 'public') = 'hidden'
    or coalesce(v_sale_state, 'available') in ('closed', 'sold_out', 'suspended') then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'state', 'PUBLIC',
    'catalog_product_id', v_pointer.catalog_product_id,
    'package_id', v_pointer.package_id,
    'revision_id', v_pointer.current_revision_id,
    'snapshot_id', v_pointer.current_snapshot_id,
    'pointer_version', v_pointer.pointer_version
  );
end;
$$;

create or replace view public.product_registration_customer_fact_view
with (security_invoker = true)
as
with latest_revisions as (
  select distinct on (revision.tenant_id, revision.catalog_product_id)
    revision.tenant_id,
    revision.catalog_product_id,
    revision.id as revision_id
  from public.product_registration_v5_revisions revision
  where revision.catalog_product_id is not null
  order by revision.tenant_id, revision.catalog_product_id,
    revision.revision_no desc, revision.created_at desc
)
select
  pointer.tenant_id,
  pointer.catalog_product_id as product_id,
  pointer.package_id,
  pointer.current_revision_id as revision_id,
  pointer.current_snapshot_id as snapshot_id,
  snapshot.snapshot_hash,
  snapshot.card_projection,
  snapshot.lp_projection,
  snapshot.snapshot_json,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'proof_id', proof.id,
      'route', proof.route,
      'status', proof.status,
      'snapshot_hash', proof.snapshot_hash,
      'renderer_build_id', proof.renderer_build_id,
      'viewport', proof.viewport,
      'screenshot_hash', proof.screenshot_hash,
      'checked_at', proof.checked_at
    ) order by proof.route)
    from public.product_registration_v5_proof_runs proof
    where proof.revision_id = pointer.current_revision_id
      and proof.public_snapshot_id = pointer.current_snapshot_id
      and proof.snapshot_hash = snapshot.snapshot_hash
      and proof.status = 'passed'
  ), '[]'::jsonb) as browser_proofs,
  pointer.pointer_version
from public.product_registration_v5_publication_pointers pointer
join latest_revisions latest
  on latest.tenant_id = pointer.tenant_id
 and latest.catalog_product_id = pointer.catalog_product_id
 and latest.revision_id = pointer.current_revision_id
join public.public_package_snapshots snapshot
  on snapshot.id = pointer.current_snapshot_id
 and snapshot.tenant_id = pointer.tenant_id
 and snapshot.package_id = pointer.package_id
 and snapshot.catalog_product_id = pointer.catalog_product_id
 and snapshot.canonical_revision_id = pointer.current_revision_id
 and snapshot.status = 'published'
left join internal_product_registration.package_availability_overlays overlay
  on overlay.tenant_id = pointer.tenant_id
 and overlay.catalog_product_id = pointer.catalog_product_id
 and overlay.channel = pointer.channel
 and (overlay.expires_at is null or overlay.expires_at > now())
where pointer.channel = 'customer'
  and pointer.locale = 'ko-KR'
  and pointer.state = 'published'
  and exists (
    select 1
    from public.product_registration_v5_proof_runs proof_gate
    where proof_gate.revision_id = pointer.current_revision_id
      and proof_gate.public_snapshot_id = pointer.current_snapshot_id
      and proof_gate.snapshot_hash = snapshot.snapshot_hash
      and proof_gate.status = 'passed'
  )
  and coalesce(overlay.customer_visibility_state, 'public') = 'public'
  and coalesce(overlay.sale_state, 'available') not in ('closed', 'sold_out', 'suspended');

revoke all on public.product_registration_customer_fact_view
  from public, anon, authenticated;
grant select on public.product_registration_customer_fact_view to service_role;

create or replace view internal_product_registration.admin_package_publication_truth_v
with (security_invoker = true)
as
select
  catalog.tenant_id,
  catalog.id as catalog_product_id,
  catalog.product_key,
  catalog.identity_status,
  catalog.lifecycle_state,
  latest_revision.id as latest_revision_id,
  latest_revision.revision_no as latest_revision_no,
  latest_revision.status as latest_revision_status,
  latest_revision.payload_hash as latest_revision_hash,
  source_document.sha256 as source_hash,
  package.id as package_id,
  package.title as package_title,
  package.status as compatibility_status,
  package.publication_state as compatibility_publication_state,
  package.canonical_revision_id as compatibility_revision_id,
  pointer.state as pointer_state,
  pointer.pointer_version,
  pointer.current_revision_id as pointer_revision_id,
  pointer.current_snapshot_id as pointer_snapshot_id,
  snapshot.status as snapshot_status,
  snapshot.snapshot_hash,
  snapshot.renderer_build_id,
  proof.id as proof_id,
  proof.status as proof_status,
  proof.proof_hash,
  proof.checked_at as proof_checked_at,
  coalesce(overlay.customer_visibility_state, 'public') as customer_visibility_state,
  coalesce(overlay.sale_state, 'available') as sale_state,
  overlay.expires_at as availability_expires_at,
  request.id as latest_publication_request_id,
  request.status as latest_publication_request_status,
  convergence.required_surface_count,
  convergence.converged_surface_count,
  convergence.failed_surface_count,
  convergence.stale_surface_count,
  outbox.pending_count as outbox_pending_count,
  outbox.failed_count as outbox_failed_count,
  coalesce((
    pointer.state = 'published'
    and pointer.current_revision_id = latest_revision.id
    and pointer.current_snapshot_id = snapshot.id
    and snapshot.status = 'published'
    and proof.status = 'passed'
    and coalesce(overlay.customer_visibility_state, 'public') = 'public'
    and coalesce(overlay.sale_state, 'available') not in ('closed', 'sold_out', 'suspended')
  ), false) as actual_customer_public,
  to_jsonb(array_remove(array[
    case when latest_revision.id is null then 'REVISION_MISSING' end,
    case when package.id is null then 'COMPATIBILITY_PACKAGE_MISSING' end,
    case when package.canonical_revision_id is distinct from latest_revision.id
      then 'COMPATIBILITY_REVISION_MISMATCH' end,
    case when pointer.package_id is null then 'CUSTOMER_POINTER_MISSING' end,
    case when pointer.state is distinct from 'published' then 'CUSTOMER_POINTER_NOT_PUBLISHED' end,
    case when pointer.current_revision_id is distinct from latest_revision.id
      then 'REVISION_CHANGED_REVALIDATION_REQUIRED' end,
    case when snapshot.id is null or snapshot.status is distinct from 'published'
      then 'PUBLISHED_SNAPSHOT_MISSING' end,
    case when proof.id is null or proof.status is distinct from 'passed'
      then 'MOBILE_PROOF_REQUIRED' end,
    case when coalesce(overlay.customer_visibility_state, 'public') <> 'public'
      then 'CUSTOMER_VISIBILITY_BLOCKED' end,
    case when coalesce(overlay.sale_state, 'available') in ('closed', 'sold_out', 'suspended')
      then 'SALE_NOT_AVAILABLE' end,
    case when coalesce(convergence.failed_surface_count, 0) > 0
      then 'SURFACE_CONVERGENCE_FAILED' end,
    case when coalesce(convergence.stale_surface_count, 0) > 0
      then 'SURFACE_CONVERGENCE_STALE' end,
    case when coalesce(outbox.failed_count, 0) > 0
      then 'PUBLICATION_OUTBOX_FAILED' end
  ]::text[], null)) as blocker_codes,
  case
    when latest_revision.id is null then '원문에서 새 리비전을 생성하세요.'
    when package.canonical_revision_id is distinct from latest_revision.id
      then '최신 리비전으로 호환 projection을 다시 생성하세요.'
    when snapshot.id is null then '고객용 스냅샷을 생성하세요.'
    when proof.id is null then '390×844 패키지·LP 모바일 검사를 실행하세요.'
    when pointer.current_revision_id is distinct from latest_revision.id
      then '상품이 변경되었습니다. 모바일 검사를 다시 실행하세요.'
    when pointer.state is distinct from 'published'
      then '검수 승인 후 공개 심사를 시작하세요.'
    when coalesce(convergence.failed_surface_count, 0) > 0
      then '공개가 차단되었습니다. 수렴 오류를 확인하세요.'
    else '현재 고객 공개 상태를 유지하고 정기 검증을 확인하세요.'
  end as next_action
from internal_product_registration.catalog_products catalog
left join lateral (
  select revision.*
  from public.product_registration_v5_revisions revision
  where revision.tenant_id = catalog.tenant_id
    and revision.catalog_product_id = catalog.id
  order by revision.revision_no desc, revision.created_at desc
  limit 1
) latest_revision on true
left join public.product_source_documents source_document
  on source_document.id = latest_revision.source_document_id
left join lateral (
  select compatibility.*
  from public.travel_packages compatibility
  where compatibility.tenant_id = catalog.tenant_id
    and compatibility.catalog_product_id = catalog.id
  order by compatibility.updated_at desc, compatibility.created_at desc
  limit 1
) package on true
left join public.product_registration_v5_publication_pointers pointer
  on pointer.tenant_id = catalog.tenant_id
 and pointer.catalog_product_id = catalog.id
 and pointer.package_id = package.id
 and pointer.channel = 'customer'
 and pointer.locale = 'ko-KR'
left join public.public_package_snapshots snapshot
  on snapshot.id = pointer.current_snapshot_id
 and snapshot.catalog_product_id = catalog.id
 and snapshot.canonical_revision_id = pointer.current_revision_id
left join lateral (
  select proof_row.*
  from public.product_registration_v5_proof_runs proof_row
  where proof_row.tenant_id = catalog.tenant_id
    and proof_row.catalog_product_id = catalog.id
    and proof_row.package_id = package.id
    and proof_row.revision_id = pointer.current_revision_id
    and proof_row.public_snapshot_id = pointer.current_snapshot_id
  order by (proof_row.status = 'passed') desc, proof_row.checked_at desc nulls last,
    proof_row.created_at desc
  limit 1
) proof on true
left join internal_product_registration.package_availability_overlays overlay
  on overlay.tenant_id = catalog.tenant_id
 and overlay.catalog_product_id = catalog.id
 and overlay.channel = 'customer'
 and (overlay.expires_at is null or overlay.expires_at > now())
left join lateral (
  select request_row.*
  from internal_product_registration.publication_requests request_row
  where request_row.tenant_id = catalog.tenant_id
    and request_row.catalog_product_id = catalog.id
  order by request_row.requested_at desc
  limit 1
) request on true
left join lateral (
  select
    count(*) filter (where run.surface in ('packages', 'lp'))::int as required_surface_count,
    count(*) filter (
      where run.surface in ('packages', 'lp') and run.status = 'converged'
    )::int as converged_surface_count,
    count(*) filter (
      where run.surface in ('packages', 'lp') and run.status = 'failed'
    )::int as failed_surface_count,
    count(*) filter (
      where run.surface in ('packages', 'lp') and run.status = 'stale'
    )::int as stale_surface_count
  from public.product_registration_v5_cache_convergence_runs run
  where run.tenant_id = catalog.tenant_id
    and run.catalog_product_id = catalog.id
    and run.package_id = package.id
    and run.snapshot_id = pointer.current_snapshot_id
) convergence on true
left join lateral (
  select
    count(*) filter (where event.status in ('pending', 'processing'))::int as pending_count,
    count(*) filter (where event.status in ('failed', 'dead_letter'))::int as failed_count
  from public.product_registration_v5_publication_outbox event
  where event.tenant_id = catalog.tenant_id
    and event.catalog_product_id = catalog.id
    and event.aggregate_id = package.id
) outbox on true;

revoke all on internal_product_registration.admin_package_publication_truth_v
  from public, anon, authenticated;
grant select on internal_product_registration.admin_package_publication_truth_v
  to service_role;

create or replace function public.get_product_registration_admin_publication_truth(
  p_tenant_id uuid,
  p_catalog_product_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(truth) order by truth.product_key), '[]'::jsonb)
  from (
    select *
    from internal_product_registration.admin_package_publication_truth_v view_row
    where view_row.tenant_id = p_tenant_id
      and (p_catalog_product_id is null or view_row.catalog_product_id = p_catalog_product_id)
    order by view_row.product_key
    limit least(greatest(p_limit, 1), 200)
    offset greatest(p_offset, 0)
  ) truth;
$$;

revoke all on function public.get_product_registration_admin_publication_truth(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_product_registration_admin_publication_truth(uuid, uuid, integer, integer)
  to service_role;

create or replace function public.publish_product_registration_snapshot_bundle_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_request_id uuid := nullif(p_payload->>'publication_request_id', '')::uuid;
  v_request internal_product_registration.publication_requests%rowtype;
  v_publication jsonb;
  v_channel text;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_seen_channels text[] := array[]::text[];
begin
  if v_request_id is null
    or jsonb_typeof(p_payload->'publications') is distinct from 'array'
    or jsonb_array_length(p_payload->'publications') = 0 then
    raise exception 'REGISTRATION_PUBLICATION_BUNDLE_INPUT_REQUIRED';
  end if;

  select request.* into v_request
  from internal_product_registration.publication_requests request
  where request.id = v_request_id
  for update;
  if not found or v_request.status not in ('ready', 'pointer_committed') then
    raise exception 'REGISTRATION_PUBLICATION_REQUEST_NOT_READY';
  end if;

  if v_request.tenant_id is distinct from nullif(p_payload->>'tenant_id', '')::uuid
    or v_request.catalog_product_id is distinct from nullif(p_payload->>'catalog_product_id', '')::uuid
    or v_request.package_id is distinct from nullif(p_payload->>'package_id', '')::uuid
    or v_request.expected_revision_id is distinct from nullif(p_payload->>'revision_id', '')::uuid then
    raise exception 'REGISTRATION_PUBLICATION_REQUEST_LINEAGE_MISMATCH';
  end if;

  for v_publication in
    select value from jsonb_array_elements(p_payload->'publications')
  loop
    v_channel := nullif(v_publication->>'channel', '');
    if v_channel is null
      or not (v_channel = any(v_request.channels))
      or v_channel = any(v_seen_channels) then
      raise exception 'REGISTRATION_PUBLICATION_BUNDLE_CHANNEL_INVALID';
    end if;
    if nullif(v_publication->>'expected_pointer_version', '')::bigint
      is distinct from nullif(v_request.expected_pointer_versions->>v_channel, '')::bigint then
      raise exception 'REGISTRATION_PUBLICATION_POINTER_CONFLICT:%', v_channel;
    end if;
    v_seen_channels := array_append(v_seen_channels, v_channel);

    v_result := public.publish_product_registration_snapshot_atomic(
      (p_payload - 'publications' - 'publication_request_id')
      || v_publication
      || jsonb_build_object(
        'channel', v_channel,
        'locale', v_request.locale
      )
    );
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('channel', v_channel, 'result', v_result)
    );
  end loop;

  if cardinality(v_seen_channels) is distinct from cardinality(v_request.channels) then
    raise exception 'REGISTRATION_PUBLICATION_BUNDLE_CHANNEL_INCOMPLETE';
  end if;

  update internal_product_registration.publication_requests
  set status = 'pointer_committed',
      snapshot_id = nullif(p_payload->>'snapshot_id', '')::uuid,
      proof_id = nullif(p_payload->>'proof_run_id', '')::uuid,
      release_manifest_hash = nullif(p_payload->>'release_manifest_hash', ''),
      error_code = null,
      error_detail = null,
      updated_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'publication_request_id', v_request_id,
    'status', 'pointer_committed',
    'publications', v_results
  );
end;
$$;

revoke all on function public.publish_product_registration_snapshot_bundle_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_product_registration_snapshot_bundle_atomic(jsonb)
  to service_role;

create or replace function internal_product_registration.mark_convergence_failed(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_request_id uuid := nullif(p_payload->>'publication_request_id', '')::uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_reason text := coalesce(nullif(btrim(p_payload->>'reason'), ''), 'SURFACE_CONVERGENCE_FAILED');
  v_updated integer := 0;
  v_already_failed integer := 0;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null
    or v_revision_id is null or v_snapshot_id is null then
    raise exception 'REGISTRATION_CONVERGENCE_FAILURE_LINEAGE_REQUIRED';
  end if;

  if v_request_id is not null and not exists (
    select 1
    from internal_product_registration.publication_requests request
    where request.id = v_request_id
      and request.tenant_id = v_tenant_id
      and request.catalog_product_id = v_catalog_product_id
      and request.package_id = v_package_id
      and request.expected_revision_id = v_revision_id
  ) then
    raise exception 'REGISTRATION_PUBLICATION_REQUEST_LINEAGE_MISMATCH';
  end if;

  perform set_config('app.product_registration_writer', 'publication-kernel', true);

  update public.product_registration_v5_publication_pointers pointer
  set state = 'convergence_failed',
      pointer_version = pointer.pointer_version + 1,
      updated_at = now()
  where pointer.tenant_id = v_tenant_id
    and pointer.catalog_product_id = v_catalog_product_id
    and pointer.package_id = v_package_id
    and pointer.current_revision_id = v_revision_id
    and pointer.current_snapshot_id = v_snapshot_id
    and pointer.state = 'published'
    and pointer.channel = any(array['customer', 'b2b', 'partner']::text[]);
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    select count(*)::integer into v_already_failed
    from public.product_registration_v5_publication_pointers pointer
    where pointer.tenant_id = v_tenant_id
      and pointer.catalog_product_id = v_catalog_product_id
      and pointer.package_id = v_package_id
      and pointer.current_revision_id = v_revision_id
      and pointer.current_snapshot_id = v_snapshot_id
      and pointer.state = 'convergence_failed'
      and pointer.channel = any(array['customer', 'b2b', 'partner']::text[]);
    if v_already_failed = 0 then
      raise exception 'REGISTRATION_CONVERGENCE_FAILURE_POINTER_MISMATCH';
    end if;
  end if;

  insert into internal_product_registration.package_availability_overlays (
    tenant_id,
    catalog_product_id,
    channel,
    sale_state,
    reason,
    overlay_version,
    customer_visibility_state,
    visibility_reason,
    updated_at
  ) values (
    v_tenant_id,
    v_catalog_product_id,
    'customer',
    'suspended',
    v_reason,
    1,
    'hidden',
    v_reason,
    now()
  )
  on conflict (tenant_id, catalog_product_id, channel) do update
  set sale_state = 'suspended',
      reason = excluded.reason,
      overlay_version = internal_product_registration.package_availability_overlays.overlay_version + 1,
      customer_visibility_state = 'hidden',
      visibility_reason = excluded.visibility_reason,
      updated_at = now();

  insert into public.product_registration_v5_publication_outbox (
    tenant_id,
    catalog_product_id,
    aggregate_type,
    aggregate_id,
    event_type,
    dedupe_key,
    payload
  ) values (
    v_tenant_id,
    v_catalog_product_id,
    'travel_package',
    v_package_id,
    'package.publication.convergence_failed',
    concat('convergence-failed:', v_package_id, ':', v_snapshot_id),
    jsonb_build_object(
      'catalog_product_id', v_catalog_product_id,
      'package_id', v_package_id,
      'revision_id', v_revision_id,
      'snapshot_id', v_snapshot_id,
      'reason', v_reason,
      'channels_blocked', v_updated
    )
  )
  on conflict (dedupe_key) do nothing;

  if v_request_id is not null then
    update internal_product_registration.publication_requests
    set status = 'convergence_failed',
        error_code = v_reason,
        error_detail = nullif(p_payload->>'error_detail', ''),
        updated_at = now(),
        completed_at = now()
    where id = v_request_id
      and tenant_id = v_tenant_id
      and catalog_product_id = v_catalog_product_id
      and package_id = v_package_id;
  end if;

  return jsonb_build_object(
    'publication_request_id', v_request_id,
    'state', 'convergence_failed',
    'blocked_pointer_count', v_updated + v_already_failed,
    'replayed', v_updated = 0 and v_already_failed > 0
  );
end;
$$;

create or replace function public.mark_product_registration_convergence_failed(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.mark_convergence_failed(p_payload);
$$;

revoke all on function internal_product_registration.mark_convergence_failed(jsonb)
  from public, anon, authenticated;
revoke all on function public.mark_product_registration_convergence_failed(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.mark_convergence_failed(jsonb)
  to service_role;
grant execute on function public.mark_product_registration_convergence_failed(jsonb)
  to service_role;

comment on table internal_product_registration.publication_requests is
  'Human- or policy-requested publication command. It records exact revision, source hash, channel CAS versions, actor and idempotency; it never edits compatibility status directly.';
comment on view internal_product_registration.admin_package_publication_truth_v is
  'One-row admin truth projection across source, latest revision, compatibility binding, pointer, snapshot, proof, availability, convergence, outbox and publication request.';
comment on function public.publish_product_registration_snapshot_bundle_atomic(jsonb) is
  'Publishes all requested channel pointers in one database transaction. Each channel keeps its own one-time release authorization and pointer CAS.';
