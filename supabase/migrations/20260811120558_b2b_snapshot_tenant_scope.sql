-- B2B keys previously authenticated a caller but did not scope which tenant's
-- catalog the key could read. Existing keys remain platform-catalog keys;
-- future keys must declare their catalog tenant explicitly.

alter table public.b2b_api_keys
  add column if not exists tenant_id uuid;

update public.b2b_api_keys
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null;

alter table public.b2b_api_keys
  alter column tenant_id set default '00000000-0000-0000-0000-000000000001'::uuid,
  alter column tenant_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'b2b_api_keys_tenant_fkey') then
    alter table public.b2b_api_keys
      add constraint b2b_api_keys_tenant_fkey
      foreign key (tenant_id) references public.tenants(id) on delete restrict;
  end if;
end;
$$;

create index if not exists idx_b2b_api_keys_tenant_active
  on public.b2b_api_keys(tenant_id, created_at desc)
  where is_active = true;
