-- Durable execution history for QA/Jarvis customer-scenario regression.
-- Keep the scenario table as the canonical backlog, and store every run here
-- so quality trends, flaky cases, and release regressions can be audited later.

create table if not exists public.qa_learning_scenario_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.qa_learning_scenarios(id) on delete cascade,
  run_group_id uuid not null default gen_random_uuid(),
  runner_version text not null default 'qa-scenario-regression-v1',
  passed boolean not null,
  score numeric(5,2) not null default 0,
  checks jsonb not null default '[]'::jsonb,
  response_preview text,
  meta jsonb not null default '{}'::jsonb,
  error text,
  elapsed_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_qa_learning_scenario_runs_scenario_created
  on public.qa_learning_scenario_runs (scenario_id, created_at desc);

create index if not exists idx_qa_learning_scenario_runs_group
  on public.qa_learning_scenario_runs (run_group_id, created_at desc);

create index if not exists idx_qa_learning_scenario_runs_failed_recent
  on public.qa_learning_scenario_runs (created_at desc)
  where passed = false;

alter table public.qa_learning_scenario_runs enable row level security;

drop policy if exists "qa_learning_scenario_runs_service_role_all" on public.qa_learning_scenario_runs;
create policy "qa_learning_scenario_runs_service_role_all"
  on public.qa_learning_scenario_runs
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.qa_learning_scenario_runs from anon, authenticated;
grant all on table public.qa_learning_scenario_runs to service_role;
