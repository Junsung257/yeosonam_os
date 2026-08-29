-- Product Registration V6.1: publication freeze manifests, customer visibility
-- preflight, and exact one-time release authorization.
--
-- This is forward-only. Existing publication pointers and immutable snapshots
-- are retained. The source-proof environment/GUC path is no longer a public
-- authorization mechanism after this migration.

create schema if not exists internal_product_registration;

alter table internal_product_registration.package_availability_overlays
  add column if not exists customer_visibility_state text not null default 'public',
  add column if not exists visibility_reason text,
  add column if not exists visibility_manifest_item_id uuid;

alter table internal_product_registration.package_availability_overlays
  drop constraint if exists package_availability_overlays_customer_visibility_state_check;
alter table internal_product_registration.package_availability_overlays
  add constraint package_availability_overlays_customer_visibility_state_check
  check (customer_visibility_state in ('public', 'under_review', 'hidden'));

alter table public.product_registration_v5_proof_runs
  add column if not exists proof_hash text;

alter table public.product_registration_v5_proof_runs
  disable trigger trg_product_registration_v5_proof_runs_immutable;
update public.product_registration_v5_proof_runs p
set proof_hash = encode(
  extensions.digest(
    convert_to(jsonb_build_object(
      'snapshotHash', p.snapshot_hash,
      'rendererBuildId', p.renderer_build_id,
      'proofSuiteVersion', p.proof_suite_version,
      'route', p.route,
      'viewport', p.viewport,
      'locale', p.locale,
      'deviceProfile', p.device_profile,
      'status', p.status,
      'result', p.result,
      'screenshotHash', p.screenshot_hash
    )::text, 'UTF8'),
    'sha256'
  ),
  'hex'
)
where p.proof_hash is null;
alter table public.product_registration_v5_proof_runs
  enable trigger trg_product_registration_v5_proof_runs_immutable;

alter table public.product_registration_v5_proof_runs
  alter column proof_hash set not null;
alter table public.product_registration_v5_proof_runs
  drop constraint if exists product_registration_v5_proof_runs_proof_hash_check;
alter table public.product_registration_v5_proof_runs
  add constraint product_registration_v5_proof_runs_proof_hash_check
  check (proof_hash ~ '^[0-9a-f]{64}$');

create table if not exists internal_product_registration.publication_freeze_manifests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  channel text not null default 'customer',
  locale text not null default 'ko-KR',
  query_version text not null check (btrim(query_version) <> ''),
  pointer_count integer not null check (pointer_count >= 0),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'captured'
    check (status in ('captured', 'applying', 'applied', 'cancelled')),
  captured_by text not null check (btrim(captured_by) <> ''),
  captured_at timestamptz not null default now(),
  applied_at timestamptz,
  application_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(application_summary) = 'object'),
  unique (tenant_id, channel, locale, manifest_hash)
);

create table if not exists internal_product_registration.publication_freeze_manifest_items (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references internal_product_registration.publication_freeze_manifests(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  package_id uuid not null references public.travel_packages(id) on delete restrict,
  customer_pointer_id text not null,
  pointer_version bigint not null check (pointer_version >= 0),
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  snapshot_id uuid not null references public.public_package_snapshots(id) on delete restrict,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  proof_id uuid references public.product_registration_v5_proof_runs(id) on delete restrict,
  proof_hash text check (proof_hash is null or proof_hash ~ '^[0-9a-f]{64}$'),
  proof_status text not null,
  public_package_url text not null,
  public_lp_url text not null,
  captured_at timestamptz not null,
  applied_overlay_version bigint,
  applied_at timestamptz,
  unique (manifest_id, package_id, customer_pointer_id)
);

create table if not exists internal_product_registration.publication_release_authorizations (
  authorization_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  package_id uuid not null references public.travel_packages(id) on delete restrict,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  snapshot_id uuid not null references public.public_package_snapshots(id) on delete restrict,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  proof_id uuid not null references public.product_registration_v5_proof_runs(id) on delete restrict,
  proof_hash text not null check (proof_hash ~ '^[0-9a-f]{64}$'),
  expected_pointer_version bigint not null check (expected_pointer_version >= 0),
  policy_version text not null check (btrim(policy_version) <> ''),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_actor text not null check (btrim(approved_actor) <> ''),
  approval_reason text not null check (btrim(approval_reason) <> ''),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_operation_key text,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((consumed_at is null) = (consumed_by_operation_key is null))
);

create index if not exists idx_pr_v61_freeze_manifest_status
  on internal_product_registration.publication_freeze_manifests(status, captured_at desc);
create index if not exists idx_pr_v61_freeze_manifest_items_product
  on internal_product_registration.publication_freeze_manifest_items(
    manifest_id, catalog_product_id, package_id
  );
create index if not exists idx_pr_v61_release_authorization_lookup
  on internal_product_registration.publication_release_authorizations(
    tenant_id, product_id, revision_id, snapshot_id, proof_id, expires_at
  ) where consumed_at is null;

alter table internal_product_registration.publication_freeze_manifests enable row level security;
alter table internal_product_registration.publication_freeze_manifest_items enable row level security;
alter table internal_product_registration.publication_release_authorizations enable row level security;

revoke all on table internal_product_registration.publication_freeze_manifests
  from public, anon, authenticated;
revoke all on table internal_product_registration.publication_freeze_manifest_items
  from public, anon, authenticated;
revoke all on table internal_product_registration.publication_release_authorizations
  from public, anon, authenticated;
grant select, insert, update on table internal_product_registration.publication_freeze_manifests
  to service_role;
grant select, insert, update on table internal_product_registration.publication_freeze_manifest_items
  to service_role;
grant select, insert, update on table internal_product_registration.publication_release_authorizations
  to service_role;

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
begin
  if p_tenant_id is null or nullif(btrim(p_route_ref), '') is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  v_route := internal_product_registration.resolve_public_route(
    p_tenant_id, p_route_ref, p_channel, p_locale
  );
  if v_route is null then return jsonb_build_object('state', 'NOT_FOUND'); end if;

  select p.* into v_pointer
  from public.product_registration_v5_publication_pointers p
  where p.tenant_id = p_tenant_id
    and p.catalog_product_id = nullif(v_route->>'catalog_product_id', '')::uuid
    and p.channel = p_channel
    and p.locale = p_locale
  limit 1;

  if not found or v_pointer.state <> 'published'
    or v_pointer.current_revision_id is null or v_pointer.current_snapshot_id is null then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;

  select a.customer_visibility_state, a.sale_state
    into v_visibility, v_sale_state
  from internal_product_registration.package_availability_overlays a
  where a.tenant_id = p_tenant_id
    and a.catalog_product_id = v_pointer.catalog_product_id
    and a.channel = p_channel
    and (a.expires_at is null or a.expires_at > now());

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

create or replace function public.get_product_registration_customer_route_state(
  p_tenant_id uuid,
  p_route_ref text,
  p_channel text default 'customer',
  p_locale text default 'ko-KR'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.resolve_customer_route_state(
    p_tenant_id, p_route_ref, p_channel, p_locale
  );
$$;

create or replace function internal_product_registration.capture_publication_freeze_manifest(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'customer');
  v_locale text := coalesce(nullif(p_payload->>'locale', ''), 'ko-KR');
  v_query_version text := nullif(btrim(p_payload->>'query_version'), '');
  v_captured_by text := nullif(btrim(p_payload->>'captured_by'), '');
  v_expected_count integer := nullif(p_payload->>'expected_count', '')::integer;
  v_captured_at timestamptz := clock_timestamp();
  v_manifest_items jsonb := '[]'::jsonb;
  v_manifest_hash text;
  v_manifest_id uuid;
  v_pointer_count integer;
  v_row record;
  v_item jsonb;
begin
  if v_tenant_id is null or v_query_version is null or v_captured_by is null then
    raise exception 'REGISTRATION_FREEZE_MANIFEST_INPUT_REQUIRED';
  end if;

  for v_row in
    select
      p.tenant_id,
      p.catalog_product_id,
      p.package_id,
      p.channel,
      p.locale,
      p.pointer_version,
      p.current_revision_id,
      r.payload_hash as revision_hash,
      p.current_snapshot_id,
      s.snapshot_hash,
      proof.id as proof_id,
      proof.proof_hash,
      coalesce(proof.status, 'missing') as proof_status
    from public.product_registration_v5_publication_pointers p
    join public.product_registration_v5_revisions r
      on r.id = p.current_revision_id
     and r.tenant_id = p.tenant_id
     and r.catalog_product_id = p.catalog_product_id
    join public.public_package_snapshots s
      on s.id = p.current_snapshot_id
     and s.package_id = p.package_id
     and s.catalog_product_id = p.catalog_product_id
     and s.canonical_revision_id = p.current_revision_id
    left join lateral (
      select pr.id, pr.proof_hash, pr.status
      from public.product_registration_v5_proof_runs pr
      where pr.tenant_id = p.tenant_id
        and pr.catalog_product_id = p.catalog_product_id
        and pr.package_id = p.package_id
        and pr.revision_id = p.current_revision_id
        and pr.public_snapshot_id = p.current_snapshot_id
        and pr.snapshot_hash = s.snapshot_hash
      order by (pr.status = 'passed') desc, pr.checked_at desc nulls last, pr.created_at desc
      limit 1
    ) proof on true
    where p.tenant_id = v_tenant_id
      and p.channel = v_channel
      and p.locale = v_locale
      and p.state = 'published'
    order by p.catalog_product_id, p.package_id
    for share of p
  loop
    v_item := jsonb_build_object(
      'tenant_id', v_row.tenant_id,
      'catalog_product_id', v_row.catalog_product_id,
      'package_id', v_row.package_id,
      'customer_pointer_id', concat_ws(':', v_row.tenant_id, v_row.package_id, v_row.channel, v_row.locale),
      'pointer_version', v_row.pointer_version,
      'revision_id', v_row.current_revision_id,
      'revision_hash', v_row.revision_hash,
      'snapshot_id', v_row.current_snapshot_id,
      'snapshot_hash', v_row.snapshot_hash,
      'proof_id', v_row.proof_id,
      'proof_hash', v_row.proof_hash,
      'proof_status', v_row.proof_status,
      'public_package_url', '/packages/' || v_row.package_id::text,
      'public_lp_url', '/lp/' || v_row.package_id::text,
      'captured_at', v_captured_at
    );
    v_manifest_items := v_manifest_items || jsonb_build_array(v_item);
  end loop;

  v_pointer_count := jsonb_array_length(v_manifest_items);
  if v_expected_count is not null and v_expected_count <> v_pointer_count then
    raise exception 'REGISTRATION_FREEZE_MANIFEST_COUNT_MISMATCH:expected %, actual %',
      v_expected_count, v_pointer_count;
  end if;
  v_manifest_hash := encode(
    extensions.digest(convert_to(v_manifest_items::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into internal_product_registration.publication_freeze_manifests (
    tenant_id, channel, locale, query_version, pointer_count, manifest_hash,
    status, captured_by, captured_at
  ) values (
    v_tenant_id, v_channel, v_locale, v_query_version, v_pointer_count,
    v_manifest_hash, 'captured', v_captured_by, v_captured_at
  )
  on conflict (tenant_id, channel, locale, manifest_hash) do update
    set query_version = excluded.query_version
  returning id into v_manifest_id;

  insert into internal_product_registration.publication_freeze_manifest_items (
    manifest_id, tenant_id, catalog_product_id, package_id, customer_pointer_id,
    pointer_version, revision_id, revision_hash, snapshot_id, snapshot_hash,
    proof_id, proof_hash, proof_status, public_package_url, public_lp_url, captured_at
  )
  select
    v_manifest_id,
    (item->>'tenant_id')::uuid,
    (item->>'catalog_product_id')::uuid,
    (item->>'package_id')::uuid,
    item->>'customer_pointer_id',
    (item->>'pointer_version')::bigint,
    (item->>'revision_id')::uuid,
    item->>'revision_hash',
    (item->>'snapshot_id')::uuid,
    item->>'snapshot_hash',
    nullif(item->>'proof_id', '')::uuid,
    nullif(item->>'proof_hash', ''),
    item->>'proof_status',
    item->>'public_package_url',
    item->>'public_lp_url',
    (item->>'captured_at')::timestamptz
  from jsonb_array_elements(v_manifest_items) item
  on conflict (manifest_id, package_id, customer_pointer_id) do nothing;

  return jsonb_build_object(
    'manifest_id', v_manifest_id,
    'manifest_hash', v_manifest_hash,
    'pointer_count', v_pointer_count,
    'query_version', v_query_version,
    'captured_at', v_captured_at
  );
end;
$$;

create or replace function public.capture_product_registration_freeze_manifest(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.capture_publication_freeze_manifest(p_payload);
$$;

create or replace function internal_product_registration.apply_publication_freeze_manifest(
  p_manifest_id uuid,
  p_manifest_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_manifest internal_product_registration.publication_freeze_manifests%rowtype;
  v_item internal_product_registration.publication_freeze_manifest_items%rowtype;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_snapshot_hash text;
  v_overlay_version bigint;
  v_applied integer := 0;
begin
  select * into v_manifest
  from internal_product_registration.publication_freeze_manifests m
  where m.id = p_manifest_id and m.manifest_hash = p_manifest_hash
  for update;
  if not found then raise exception 'REGISTRATION_FREEZE_MANIFEST_NOT_FOUND'; end if;
  if v_manifest.status = 'applied' then
    return jsonb_build_object(
      'manifest_id', v_manifest.id,
      'manifest_hash', v_manifest.manifest_hash,
      'pointer_count', v_manifest.pointer_count,
      'applied_count', v_manifest.pointer_count,
      'dedupe_hit', true
    );
  end if;
  if v_manifest.status <> 'captured' then
    raise exception 'REGISTRATION_FREEZE_MANIFEST_STATE_INVALID:%', v_manifest.status;
  end if;

  update internal_product_registration.publication_freeze_manifests
  set status = 'applying'
  where id = v_manifest.id;

  for v_item in
    select *
    from internal_product_registration.publication_freeze_manifest_items i
    where i.manifest_id = v_manifest.id
    order by i.catalog_product_id, i.package_id
  loop
    select * into v_pointer
    from public.product_registration_v5_publication_pointers p
    where p.tenant_id = v_item.tenant_id
      and p.package_id = v_item.package_id
      and p.channel = v_manifest.channel
      and p.locale = v_manifest.locale
    for update;
    if not found
      or v_pointer.catalog_product_id is distinct from v_item.catalog_product_id
      or v_pointer.pointer_version is distinct from v_item.pointer_version
      or v_pointer.current_revision_id is distinct from v_item.revision_id
      or v_pointer.current_snapshot_id is distinct from v_item.snapshot_id
      or v_pointer.state is distinct from 'published' then
      raise exception 'REGISTRATION_FREEZE_POINTER_CAS_CONFLICT:%', v_item.customer_pointer_id;
    end if;

    select s.snapshot_hash into v_snapshot_hash
    from public.public_package_snapshots s
    where s.id = v_item.snapshot_id
      and s.package_id = v_item.package_id
      and s.catalog_product_id = v_item.catalog_product_id
      and s.canonical_revision_id = v_item.revision_id;
    if v_snapshot_hash is distinct from v_item.snapshot_hash then
      raise exception 'REGISTRATION_FREEZE_SNAPSHOT_HASH_CONFLICT:%', v_item.snapshot_id;
    end if;

    insert into internal_product_registration.package_availability_overlays (
      tenant_id, catalog_product_id, channel, sale_state, reason,
      customer_visibility_state, visibility_reason, visibility_manifest_item_id,
      overlay_version, updated_at
    ) values (
      v_item.tenant_id, v_item.catalog_product_id, v_manifest.channel, 'available',
      'PUBLICATION_FREEZE_MANIFEST:' || v_manifest.id::text,
      'under_review', 'PUBLICATION_FREEZE_MANIFEST:' || v_manifest.id::text,
      v_item.id, 1, now()
    )
    on conflict (tenant_id, catalog_product_id, channel) do update
    set customer_visibility_state = 'under_review',
        visibility_reason = excluded.visibility_reason,
        visibility_manifest_item_id = excluded.visibility_manifest_item_id,
        overlay_version = internal_product_registration.package_availability_overlays.overlay_version + 1,
        updated_at = now()
    returning overlay_version into v_overlay_version;

    update internal_product_registration.publication_freeze_manifest_items
    set applied_overlay_version = v_overlay_version,
        applied_at = now()
    where id = v_item.id;

    insert into public.product_registration_v5_publication_outbox (
      tenant_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload
    ) values (
      v_item.tenant_id, 'catalog_product', v_item.catalog_product_id,
      'package.visibility.under_review',
      'v61:freeze:' || v_manifest.id::text || ':' || v_item.catalog_product_id::text,
      jsonb_build_object(
        'package_id', v_item.package_id,
        'catalog_product_id', v_item.catalog_product_id,
        'revision_id', v_item.revision_id,
        'snapshot_id', v_item.snapshot_id,
        'snapshot_hash', v_item.snapshot_hash,
        'pointer_version', v_item.pointer_version,
        'visibility_state', 'under_review',
        'manifest_id', v_manifest.id
      )
    ) on conflict (dedupe_key) do nothing;
    v_applied := v_applied + 1;
  end loop;

  if v_applied <> v_manifest.pointer_count then
    raise exception 'REGISTRATION_FREEZE_APPLY_COUNT_MISMATCH:expected %, actual %',
      v_manifest.pointer_count, v_applied;
  end if;

  update internal_product_registration.publication_freeze_manifests
  set status = 'applied',
      applied_at = now(),
      application_summary = jsonb_build_object('applied_count', v_applied)
  where id = v_manifest.id;

  return jsonb_build_object(
    'manifest_id', v_manifest.id,
    'manifest_hash', v_manifest.manifest_hash,
    'pointer_count', v_manifest.pointer_count,
    'applied_count', v_applied,
    'dedupe_hit', false
  );
end;
$$;

create or replace function public.apply_product_registration_freeze_manifest(
  p_manifest_id uuid,
  p_manifest_hash text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.apply_publication_freeze_manifest(
    p_manifest_id, p_manifest_hash
  );
$$;

create or replace function public.claim_product_registration_v61_outbox(
  p_worker_id text,
  p_aggregate_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.product_registration_v5_publication_outbox%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'REGISTRATION_OUTBOX_WORKER_ID_REQUIRED';
  end if;
  with candidate as (
    select o.id
    from public.product_registration_v5_publication_outbox o
    where o.status in ('pending', 'failed')
      and o.available_at <= now()
      and (p_aggregate_ids is null or o.aggregate_id = any(p_aggregate_ids))
    order by o.created_at
    for update skip locked
    limit 1
  )
  update public.product_registration_v5_publication_outbox o
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = o.attempts + 1,
      updated_at = now()
  from candidate c
  where o.id = c.id
  returning o.* into v_row;
  if not found then return null; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function internal_product_registration.issue_release_authorization(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_product_id uuid := nullif(p_payload->>'product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_proof_id uuid := nullif(p_payload->>'proof_id', '')::uuid;
  v_expected_pointer_version bigint := nullif(p_payload->>'expected_pointer_version', '')::bigint;
  v_expires_at timestamptz := nullif(p_payload->>'expires_at', '')::timestamptz;
  v_authorization_id uuid;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_revision_hash text;
  v_snapshot_hash text;
  v_proof_hash text;
begin
  if v_tenant_id is null or v_product_id is null or v_package_id is null
    or v_revision_id is null or v_snapshot_id is null or v_proof_id is null
    or v_expected_pointer_version is null or v_expires_at is null
    or nullif(btrim(p_payload->>'policy_version'), '') is null
    or nullif(btrim(p_payload->>'approved_actor'), '') is null
    or nullif(btrim(p_payload->>'approval_reason'), '') is null then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_INPUT_REQUIRED';
  end if;
  if v_expires_at <= now() or v_expires_at > now() + interval '24 hours' then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_EXPIRY_INVALID';
  end if;

  select * into v_pointer
  from public.product_registration_v5_publication_pointers p
  where p.tenant_id = v_tenant_id
    and p.catalog_product_id = v_product_id
    and p.package_id = v_package_id
    and p.channel = coalesce(nullif(p_payload->>'channel', ''), 'customer')
    and p.locale = coalesce(nullif(p_payload->>'locale', ''), 'ko-KR')
  for share;
  if (found and v_pointer.pointer_version <> v_expected_pointer_version)
    or (not found and v_expected_pointer_version <> 0) then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_POINTER_CONFLICT';
  end if;

  select r.payload_hash into v_revision_hash
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_product_id;
  select s.snapshot_hash into v_snapshot_hash
  from public.public_package_snapshots s
  where s.id = v_snapshot_id and s.package_id = v_package_id
    and s.catalog_product_id = v_product_id and s.canonical_revision_id = v_revision_id;
  select pr.proof_hash into v_proof_hash
  from public.product_registration_v5_proof_runs pr
  where pr.id = v_proof_id and pr.tenant_id = v_tenant_id
    and pr.catalog_product_id = v_product_id and pr.package_id = v_package_id
    and pr.revision_id = v_revision_id and pr.public_snapshot_id = v_snapshot_id
    and pr.status = 'passed';
  if v_revision_hash is distinct from p_payload->>'revision_hash'
    or v_snapshot_hash is distinct from p_payload->>'snapshot_hash'
    or v_proof_hash is distinct from p_payload->>'proof_hash' then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_LINEAGE_MISMATCH';
  end if;

  insert into internal_product_registration.publication_release_authorizations (
    tenant_id, product_id, package_id, revision_id, revision_hash,
    snapshot_id, snapshot_hash, proof_id, proof_hash, expected_pointer_version,
    policy_version, approved_by, approved_actor, approval_reason, expires_at
  ) values (
    v_tenant_id, v_product_id, v_package_id, v_revision_id, v_revision_hash,
    v_snapshot_id, v_snapshot_hash, v_proof_id, v_proof_hash, v_expected_pointer_version,
    p_payload->>'policy_version', nullif(p_payload->>'approved_by', '')::uuid,
    p_payload->>'approved_actor', p_payload->>'approval_reason', v_expires_at
  ) returning authorization_id into v_authorization_id;

  return jsonb_build_object(
    'authorization_id', v_authorization_id,
    'expires_at', v_expires_at,
    'expected_pointer_version', v_expected_pointer_version
  );
end;
$$;

create or replace function public.issue_product_registration_release_authorization(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.issue_release_authorization(p_payload);
$$;

-- Reassert the freeze trigger without the source-proof bypass. A frozen public
-- transition is accepted only inside the exact authorization wrapper below.
create or replace function internal_product_registration.assert_publication_not_frozen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_freeze boolean := true;
  v_public_transition boolean := false;
  v_authorization_id uuid := nullif(
    current_setting('app.product_registration_release_authorization', true), ''
  )::uuid;
  v_authorization internal_product_registration.publication_release_authorizations%rowtype;
  v_expected_pointer_version bigint;
begin
  select publication_freeze into v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true;
  if coalesce(v_freeze, true) is false then return new; end if;

  if tg_table_name = 'travel_packages' then
    v_public_transition := (
      coalesce(new.publication_state, '') in ('approved', 'published')
      or coalesce(new.status, '') = 'active'
    ) and (
      tg_op = 'INSERT'
      or old.publication_state is distinct from new.publication_state
      or old.status is distinct from new.status
    );
  elsif tg_table_name = 'product_registration_v5_publication_pointers' then
    v_public_transition := coalesce(new.state, '') = 'published'
      and (tg_op = 'INSERT' or old.state is distinct from new.state
        or old.current_snapshot_id is distinct from new.current_snapshot_id);
  elsif tg_table_name = 'public_package_snapshots' then
    v_public_transition := coalesce(new.status, '') = 'published'
      and (tg_op = 'INSERT' or old.status is distinct from new.status);
  elsif tg_table_name = 'package_publish_decisions' then
    v_public_transition := coalesce(new.publishable, false)
      and coalesce(new.publication_state, '') in ('approved', 'published')
      and (tg_op = 'INSERT' or old.publication_state is distinct from new.publication_state
        or old.publishable is distinct from new.publishable);
  end if;

  if not v_public_transition then return new; end if;
  if v_authorization_id is null then raise exception 'REGISTRATION_PUBLICATION_FROZEN'; end if;

  select * into v_authorization
  from internal_product_registration.publication_release_authorizations a
  where a.authorization_id = v_authorization_id
    and a.consumed_at is null
    and a.expires_at > now();
  if not found then raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_INVALID'; end if;

  if tg_table_name = 'product_registration_v5_publication_pointers' then
    v_expected_pointer_version := case when tg_op = 'INSERT' then 0 else old.pointer_version end;
    if new.tenant_id is distinct from v_authorization.tenant_id
      or new.catalog_product_id is distinct from v_authorization.product_id
      or new.package_id is distinct from v_authorization.package_id
      or new.current_revision_id is distinct from v_authorization.revision_id
      or new.current_snapshot_id is distinct from v_authorization.snapshot_id
      or v_expected_pointer_version is distinct from v_authorization.expected_pointer_version then
      raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_POINTER_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

-- This public function is now the only service-role publication entry point.
-- During freeze it turns a checked one-time authorization into the private
-- compatibility GUC required by the older inner CAS implementation.
create or replace function public.publish_product_registration_snapshot_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_freeze boolean := true;
  v_authorization_id uuid := nullif(p_payload->>'release_authorization_id', '')::uuid;
  v_authorization internal_product_registration.publication_release_authorizations%rowtype;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_existing_response jsonb;
  v_internal_payload jsonb := p_payload - 'release_authorization_id' - 'proof_hash' - 'revision_hash';
  v_result jsonb;
  v_revision_hash text;
  v_proof_hash text;
begin
  select publication_freeze into v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;

  if not coalesce(v_freeze, true) then
    v_internal_payload := jsonb_set(v_internal_payload, '{source_proof_auto_publish}', 'false'::jsonb, true);
    return internal_product_registration.publish_snapshot_atomic(v_internal_payload);
  end if;

  if v_authorization_id is null or v_operation_key is null then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_REQUIRED';
  end if;
  select * into v_authorization
  from internal_product_registration.publication_release_authorizations a
  where a.authorization_id = v_authorization_id
  for update;
  if not found then raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_INVALID'; end if;

  if v_authorization.consumed_at is not null then
    if v_authorization.consumed_by_operation_key = v_operation_key then
      select l.response into v_existing_response
      from public.product_registration_v5_idempotency_ledger l
      where l.operation_key = v_operation_key and l.status = 'succeeded';
      if v_existing_response is not null then
        return v_existing_response || jsonb_build_object(
          'release_authorization_id', v_authorization_id,
          'authorization_replay', true
        );
      end if;
    end if;
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_CONSUMED';
  end if;
  if v_authorization.expires_at <= now() then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_EXPIRED';
  end if;

  select r.payload_hash into v_revision_hash
  from public.product_registration_v5_revisions r
  where r.id = v_authorization.revision_id;
  select pr.proof_hash into v_proof_hash
  from public.product_registration_v5_proof_runs pr
  where pr.id = v_authorization.proof_id and pr.status = 'passed';

  if v_authorization.tenant_id is distinct from nullif(p_payload->>'tenant_id', '')::uuid
    or v_authorization.product_id is distinct from nullif(p_payload->>'catalog_product_id', '')::uuid
    or v_authorization.package_id is distinct from nullif(p_payload->>'package_id', '')::uuid
    or v_authorization.revision_id is distinct from nullif(p_payload->>'revision_id', '')::uuid
    or v_authorization.snapshot_id is distinct from nullif(p_payload->>'snapshot_id', '')::uuid
    or v_authorization.proof_id is distinct from nullif(p_payload->>'proof_run_id', '')::uuid
    or v_authorization.snapshot_hash is distinct from p_payload->>'snapshot_hash'
    or v_authorization.revision_hash is distinct from v_revision_hash
    or v_authorization.proof_hash is distinct from v_proof_hash
    or v_authorization.expected_pointer_version is distinct from nullif(p_payload->>'expected_pointer_version', '')::bigint
    or v_authorization.policy_version is distinct from p_payload->>'policy_version' then
    raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_LINEAGE_MISMATCH';
  end if;

  insert into internal_product_registration.cohort_quality_metrics (
    tenant_id, supplier_key, parser_version, policy_version,
    window_start, window_end, sample_count, auto_publish_count,
    critical_defect_count, exact_match_rate, publication_eligible, metrics
  )
  select
    v_authorization.tenant_id, null, r.normalization_version,
    v_authorization.policy_version, now(), least(v_authorization.expires_at, now() + interval '15 minutes'),
    1, 1, 0, null, true,
    jsonb_build_object(
      'mode', 'one_time_release_authorization',
      'benchmarkEligible', false,
      'sourceScoped', true,
      'sourceRevisionId', v_authorization.revision_id,
      'authorizationId', v_authorization.authorization_id,
      'operationKey', v_operation_key
    )
  from public.product_registration_v5_revisions r
  where r.id = v_authorization.revision_id;

  perform set_config(
    'app.product_registration_release_authorization',
    v_authorization.authorization_id::text,
    true
  );
  perform set_config('app.product_registration_source_proof', 'true', true);
  v_internal_payload := jsonb_set(v_internal_payload, '{source_proof_auto_publish}', 'true'::jsonb, true);
  v_result := internal_product_registration.publish_snapshot_atomic(v_internal_payload);

  update internal_product_registration.publication_release_authorizations
  set consumed_at = now(), consumed_by_operation_key = v_operation_key
  where authorization_id = v_authorization.authorization_id and consumed_at is null;
  if not found then raise exception 'REGISTRATION_RELEASE_AUTHORIZATION_CONSUME_CONFLICT'; end if;

  update internal_product_registration.package_availability_overlays
  set customer_visibility_state = 'public',
      visibility_reason = 'RELEASE_AUTHORIZATION:' || v_authorization.authorization_id::text,
      visibility_manifest_item_id = null,
      overlay_version = overlay_version + 1,
      updated_at = now()
  where tenant_id = v_authorization.tenant_id
    and catalog_product_id = v_authorization.product_id
    and channel = coalesce(nullif(p_payload->>'channel', ''), 'customer');

  insert into public.product_registration_v5_publication_outbox (
    tenant_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload
  ) values (
    v_authorization.tenant_id, 'catalog_product', v_authorization.product_id,
    'package.visibility.public',
    'v61:release:' || v_authorization.authorization_id::text,
    jsonb_build_object(
      'package_id', v_authorization.package_id,
      'catalog_product_id', v_authorization.product_id,
      'revision_id', v_authorization.revision_id,
      'snapshot_id', v_authorization.snapshot_id,
      'snapshot_hash', v_authorization.snapshot_hash,
      'visibility_state', 'public',
      'authorization_id', v_authorization.authorization_id
    )
  ) on conflict (dedupe_key) do nothing;

  return v_result || jsonb_build_object(
    'release_authorization_id', v_authorization.authorization_id,
    'authorization_replay', false
  );
end;
$$;

revoke all on function internal_product_registration.resolve_customer_route_state(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_customer_route_state(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function internal_product_registration.capture_publication_freeze_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.capture_product_registration_freeze_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.apply_publication_freeze_manifest(uuid, text)
  from public, anon, authenticated;
revoke all on function public.apply_product_registration_freeze_manifest(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_product_registration_v61_outbox(text, uuid[])
  from public, anon, authenticated;
revoke all on function internal_product_registration.issue_release_authorization(jsonb)
  from public, anon, authenticated;
revoke all on function public.issue_product_registration_release_authorization(jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_product_registration_snapshot_atomic(jsonb)
  from public, anon, authenticated;
revoke execute on function internal_product_registration.publish_snapshot_atomic(jsonb)
  from service_role;

grant execute on function public.get_product_registration_customer_route_state(uuid, text, text, text)
  to service_role;
grant execute on function public.capture_product_registration_freeze_manifest(jsonb)
  to service_role;
grant execute on function public.apply_product_registration_freeze_manifest(uuid, text)
  to service_role;
grant execute on function public.claim_product_registration_v61_outbox(text, uuid[])
  to service_role;
grant execute on function public.issue_product_registration_release_authorization(jsonb)
  to service_role;
grant execute on function public.publish_product_registration_snapshot_atomic(jsonb)
  to service_role;

comment on function public.get_product_registration_customer_route_state(uuid, text, text, text) is
  'V6.1 lightweight customer route preflight. It never reads immutable snapshot JSON.';
comment on function public.publish_product_registration_snapshot_atomic(jsonb) is
  'V6.1 CAS publication. During global freeze an exact unexpired one-time authorization is mandatory and consumed atomically.';
