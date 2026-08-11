-- Reject the historical internal_code-only product/package join when the two
-- rows belong to different tenants. Package codes are not globally unique
-- identities. Every compatibility projection must point to a catalog product
-- owned by the same tenant before kernel authority can be finalized.

update public.travel_packages p
set tenant_id = cp.tenant_id
from internal_product_registration.catalog_products cp
where p.catalog_product_id = cp.id
  and p.tenant_id is null;

update public.travel_packages
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null
   or tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

update public.products
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null
   or tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- The previous additive backfill intentionally preserved legacy matching.
-- Clear only cross-tenant matches; same-tenant unambiguous links remain valid.
update public.products pr
set catalog_product_id = null
from internal_product_registration.catalog_products cp
where pr.catalog_product_id = cp.id
  and cp.tenant_id is distinct from pr.tenant_id;

with same_tenant_matches as (
  select
    p.tenant_id,
    p.internal_code,
    min(p.catalog_product_id::text)::uuid as catalog_product_id
  from public.travel_packages p
  where p.internal_code is not null
    and p.catalog_product_id is not null
  group by p.tenant_id, p.internal_code
  having count(*) = 1
)
update public.products pr
set catalog_product_id = match.catalog_product_id
from same_tenant_matches match
where pr.catalog_product_id is null
  and pr.tenant_id = match.tenant_id
  and pr.internal_code = match.internal_code;

insert into internal_product_registration.catalog_products (
  tenant_id, product_key, identity_status, lifecycle_state, source_channel, metadata
)
select
  pr.tenant_id,
  'legacy:product:' || pr.internal_code,
  case
    when exists (
      select 1
      from public.travel_packages p
      where p.tenant_id = pr.tenant_id
        and p.internal_code = pr.internal_code
    ) then 'conflicting'
    else 'orphaned'
  end,
  case
    when exists (
      select 1
      from public.travel_packages p
      where p.tenant_id = pr.tenant_id
        and p.internal_code = pr.internal_code
    ) then 'quarantined'
    else 'active'
  end,
  'legacy_backfill',
  jsonb_build_object(
    'products_internal_code', pr.internal_code,
    'cross_tenant_match_rejected', exists (
      select 1
      from public.travel_packages p
      where p.tenant_id is distinct from pr.tenant_id
        and p.internal_code = pr.internal_code
    )
  )
from public.products pr
where pr.catalog_product_id is null
  and nullif(btrim(pr.internal_code), '') is not null
on conflict (tenant_id, product_key) do nothing;

update public.products pr
set catalog_product_id = cp.id
from internal_product_registration.catalog_products cp
where pr.catalog_product_id is null
  and cp.tenant_id = pr.tenant_id
  and cp.product_key = 'legacy:product:' || pr.internal_code;

update public.public_package_snapshots s
set tenant_id = p.tenant_id,
    catalog_product_id = coalesce(s.catalog_product_id, p.catalog_product_id)
from public.travel_packages p
where s.package_id = p.id
  and (s.tenant_id is null or s.catalog_product_id is null);

update public.product_registration_v5_publication_pointers ptr
set tenant_id = p.tenant_id,
    catalog_product_id = coalesce(ptr.catalog_product_id, p.catalog_product_id)
from public.travel_packages p
where ptr.package_id = p.id
  and (ptr.tenant_id is null or ptr.catalog_product_id is null);

update public.package_publish_decisions d
set tenant_id = p.tenant_id,
    catalog_product_id = coalesce(d.catalog_product_id, p.catalog_product_id)
from public.travel_packages p
where d.package_id = p.id
  and (d.tenant_id is null or d.catalog_product_id is null);

update public.product_registration_v5_kill_switches
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null;

do $$
declare
  v_blockers bigint;
begin
  select
    (select count(*) from public.products where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.travel_packages where tenant_id is null or catalog_product_id is null)
    + (
      select count(*)
      from public.products pr
      join internal_product_registration.catalog_products cp on cp.id = pr.catalog_product_id
      where cp.tenant_id is distinct from pr.tenant_id
    )
    + (
      select count(*)
      from public.travel_packages p
      join internal_product_registration.catalog_products cp on cp.id = p.catalog_product_id
      where cp.tenant_id is distinct from p.tenant_id
    )
  into v_blockers;
  if v_blockers > 0 then
    raise exception 'REGISTRATION_TENANT_IDENTITY_RECONCILIATION_BLOCKED:%', v_blockers;
  end if;
end;
$$;

alter table public.products alter column tenant_id set not null;
alter table public.products alter column catalog_product_id set not null;
alter table public.travel_packages alter column tenant_id set not null;
alter table public.travel_packages alter column catalog_product_id set not null;
alter table public.product_registration_v5_kill_switches alter column tenant_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_tenant_catalog_product_fk') then
    alter table public.products
      add constraint products_tenant_catalog_product_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'travel_packages_tenant_catalog_product_fk') then
    alter table public.travel_packages
      add constraint travel_packages_tenant_catalog_product_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_registration_v5_kill_switches_tenant_fkey') then
    alter table public.product_registration_v5_kill_switches
      add constraint product_registration_v5_kill_switches_tenant_fkey
      foreign key (tenant_id) references public.tenants(id) on delete restrict;
  end if;
end;
$$;

alter table public.products validate constraint products_tenant_catalog_product_fk;
alter table public.travel_packages validate constraint travel_packages_tenant_catalog_product_fk;
