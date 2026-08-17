-- Customer route resolution belongs to the catalog/publication authority, not
-- to mutable travel_packages rows. Legacy UUIDs and short codes are retained
-- only as aliases that resolve to the stable catalog identity.

create table if not exists internal_product_registration.public_route_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete cascade,
  package_id uuid references public.travel_packages(id) on delete set null,
  route_ref text not null check (btrim(route_ref) <> ''),
  route_key text generated always as (lower(btrim(route_ref))) stored,
  channel text not null default 'customer',
  locale text not null default 'ko-KR',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, route_key, channel, locale)
);

create index if not exists idx_product_registration_public_route_catalog
  on internal_product_registration.public_route_aliases(
    tenant_id, catalog_product_id, channel, locale, is_primary desc
  );

alter table internal_product_registration.public_route_aliases enable row level security;
revoke all on table internal_product_registration.public_route_aliases from public, anon, authenticated;
grant all on table internal_product_registration.public_route_aliases to service_role;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select tenant_id, id, null, id::text, 'customer', 'ko-KR', true
from internal_product_registration.catalog_products
on conflict (tenant_id, route_key, channel, locale) do nothing;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select p.tenant_id, p.id, null, p.id::text, channel.name, 'ko-KR', true
from internal_product_registration.catalog_products p
cross join (values ('b2b'), ('partner')) as channel(name)
on conflict (tenant_id, route_key, channel, locale) do nothing;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select p.tenant_id, p.catalog_product_id, p.id, p.id::text, 'customer', 'ko-KR', false
from public.travel_packages p
where p.tenant_id is not null and p.catalog_product_id is not null
on conflict (tenant_id, route_key, channel, locale) do update
set catalog_product_id = excluded.catalog_product_id,
    package_id = excluded.package_id;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select p.tenant_id, p.catalog_product_id, p.id, p.id::text, channel.name, 'ko-KR', false
from public.travel_packages p
cross join (values ('b2b'), ('partner')) as channel(name)
where p.tenant_id is not null and p.catalog_product_id is not null
on conflict (tenant_id, route_key, channel, locale) do update
set catalog_product_id = excluded.catalog_product_id,
    package_id = excluded.package_id;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select p.tenant_id, p.catalog_product_id, p.id, p.short_code, 'customer', 'ko-KR', false
from public.travel_packages p
where p.tenant_id is not null
  and p.catalog_product_id is not null
  and nullif(btrim(p.short_code), '') is not null
  and 1 = (
    select count(*)
    from public.travel_packages same_ref
    where same_ref.tenant_id = p.tenant_id
      and lower(btrim(same_ref.short_code)) = lower(btrim(p.short_code))
  )
on conflict (tenant_id, route_key, channel, locale) do update
set catalog_product_id = excluded.catalog_product_id,
    package_id = excluded.package_id;

insert into internal_product_registration.public_route_aliases (
  tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
)
select p.tenant_id, p.catalog_product_id, p.id, p.short_code, channel.name, 'ko-KR', false
from public.travel_packages p
cross join (values ('b2b'), ('partner')) as channel(name)
where p.tenant_id is not null
  and p.catalog_product_id is not null
  and nullif(btrim(p.short_code), '') is not null
  and 1 = (
    select count(*)
    from public.travel_packages same_ref
    where same_ref.tenant_id = p.tenant_id
      and lower(btrim(same_ref.short_code)) = lower(btrim(p.short_code))
  )
on conflict (tenant_id, route_key, channel, locale) do update
set catalog_product_id = excluded.catalog_product_id,
    package_id = excluded.package_id;

create or replace function internal_product_registration.register_public_route_aliases(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'customer');
  v_locale text := coalesce(nullif(p_payload->>'locale', ''), 'ko-KR');
  v_ref text;
  v_count integer := 0;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null then
    raise exception 'REGISTRATION_ROUTE_ALIAS_LINEAGE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.travel_packages p
    where p.id = v_package_id
      and p.tenant_id = v_tenant_id
      and p.catalog_product_id = v_catalog_product_id
  ) then raise exception 'REGISTRATION_ROUTE_ALIAS_IDENTITY_MISMATCH'; end if;

  for v_ref in
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_payload->'route_refs', '[]'::jsonb))
    where nullif(btrim(value), '') is not null
  loop
    insert into internal_product_registration.public_route_aliases (
      tenant_id, catalog_product_id, package_id, route_ref, channel, locale, is_primary
    ) values (
      v_tenant_id, v_catalog_product_id, v_package_id, v_ref, v_channel, v_locale,
      lower(v_ref) = lower(v_catalog_product_id::text)
    )
    on conflict (tenant_id, route_key, channel, locale) do update
    set catalog_product_id = excluded.catalog_product_id,
        package_id = excluded.package_id,
        is_primary = excluded.is_primary;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('registered', v_count);
end;
$$;

create or replace function public.register_product_registration_public_route_aliases(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.register_public_route_aliases(p_payload);
$$;

create or replace function internal_product_registration.resolve_public_route(
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
  select jsonb_build_object(
    'tenant_id', a.tenant_id,
    'catalog_product_id', a.catalog_product_id,
    'package_id', a.package_id,
    'route_ref', a.route_ref
  )
  from internal_product_registration.public_route_aliases a
  where a.tenant_id = p_tenant_id
    and a.route_key = lower(btrim(p_route_ref))
    and a.channel = p_channel
    and a.locale = p_locale
  limit 1;
$$;

create or replace function public.resolve_product_registration_public_route(
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
  select internal_product_registration.resolve_public_route(
    p_tenant_id, p_route_ref, p_channel, p_locale
  );
$$;

revoke all on function internal_product_registration.register_public_route_aliases(jsonb)
  from public, anon, authenticated;
revoke all on function public.register_product_registration_public_route_aliases(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.resolve_public_route(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.resolve_product_registration_public_route(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_product_registration_public_route_aliases(jsonb) to service_role;
grant execute on function public.resolve_product_registration_public_route(uuid, text, text, text) to service_role;
