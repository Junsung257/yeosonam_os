-- Runtime AI provider policy table used by Jarvis/LLM gateway.
-- Server routes access this with the service role; clients must not read or mutate it.

create table if not exists public.system_ai_policies (
  task text primary key,
  provider text not null check (provider in ('deepseek', 'claude', 'gemini')),
  model text,
  fallback_provider text check (fallback_provider is null or fallback_provider in ('deepseek', 'claude', 'gemini')),
  fallback_model text,
  timeout_ms integer check (timeout_ms is null or timeout_ms > 0),
  enabled boolean not null default true,
  note text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_ai_policies_enabled_updated
  on public.system_ai_policies (enabled, updated_at desc);

alter table public.system_ai_policies enable row level security;

drop policy if exists "system_ai_policies_service_role_all" on public.system_ai_policies;
create policy "system_ai_policies_service_role_all"
  on public.system_ai_policies
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.system_ai_policies from anon, authenticated;
grant all on table public.system_ai_policies to service_role;
