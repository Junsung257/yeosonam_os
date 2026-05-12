-- system_ai_policies
-- 운영 중 재배포 없이 AI provider/model/fallback/timeout 전환

create table if not exists public.system_ai_policies (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  provider text not null check (provider in ('deepseek', 'claude', 'gemini')),
  model text,
  fallback_provider text check (fallback_provider in ('deepseek', 'claude', 'gemini')),
  fallback_model text,
  timeout_ms int check (timeout_ms is null or timeout_ms > 0),
  enabled boolean not null default true,
  note text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists system_ai_policies_task_unique
  on public.system_ai_policies(task);

create index if not exists system_ai_policies_enabled_idx
  on public.system_ai_policies(enabled);

create or replace function public.set_system_ai_policies_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_ai_policies_updated_at on public.system_ai_policies;
create trigger trg_system_ai_policies_updated_at
before update on public.system_ai_policies
for each row
execute function public.set_system_ai_policies_updated_at();

alter table public.system_ai_policies enable row level security;

drop policy if exists "system_ai_policies_service_role_all" on public.system_ai_policies;
create policy "system_ai_policies_service_role_all"
on public.system_ai_policies
for all
to service_role
using (true)
with check (true);

insert into public.system_ai_policies (task, provider, model, fallback_provider, fallback_model, timeout_ms, enabled, note)
values
  ('*', 'deepseek', 'deepseek-v4-flash', 'gemini', 'gemini-2.5-flash', 15000, true, '전역 기본 정책'),
  ('card-news', 'deepseek', 'deepseek-v4-pro', 'gemini', 'gemini-2.5-flash', 15000, true, '카드뉴스는 Pro 우선')
on conflict (task) do update set
  provider = excluded.provider,
  model = excluded.model,
  fallback_provider = excluded.fallback_provider,
  fallback_model = excluded.fallback_model,
  timeout_ms = excluded.timeout_ms,
  enabled = excluded.enabled,
  note = excluded.note,
  updated_at = now();

