-- V5 operational controls: kill switches, cache convergence and policy
-- versions. These records are private and service-role managed.

create table if not exists public.product_registration_v5_kill_switches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  scope text not null check (scope in ('product', 'supplier', 'parser', 'model', 'global')),
  scope_key text not null,
  active boolean not null default true,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope, scope_key)
);

comment on table public.product_registration_v5_kill_switches is
  'Fail-closed publication controls for a product, supplier, parser/model cohort, or all new publications.';

create index if not exists idx_product_registration_v5_kill_switches_active
  on public.product_registration_v5_kill_switches(scope, scope_key, active, expires_at);

create table if not exists public.product_registration_v5_cache_convergence_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  package_id uuid not null references public.travel_packages(id) on delete cascade,
  snapshot_id uuid references public.public_package_snapshots(id) on delete set null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  surface text not null,
  route text not null,
  status text not null default 'pending'
    check (status in ('pending', 'converged', 'stale', 'failed')),
  observed_snapshot_hash text,
  observed_at timestamptz,
  error_detail text,
  created_at timestamptz not null default now(),
  unique (package_id, snapshot_hash, surface, route)
);

create index if not exists idx_product_registration_v5_cache_convergence_ready
  on public.product_registration_v5_cache_convergence_runs(status, created_at)
  where status in ('pending', 'stale', 'failed');

create table if not exists public.product_registration_v5_publication_policies (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null unique,
  cohort text not null,
  enabled boolean not null default false,
  hard_blockers jsonb not null default '[]'::jsonb check (jsonb_typeof(hard_blockers) = 'array'),
  risk_budget numeric(8,6) not null default 0 check (risk_budget >= 0 and risk_budget <= 1),
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'product_registration_v5_kill_switches',
    'product_registration_v5_cache_convergence_runs',
    'product_registration_v5_publication_policies'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;
