-- Real customer inquiry based scenario backlog for the QA/Jarvis learning flywheel.
-- These rows are generated automatically but start as pending/admin-reviewed by default.

create table if not exists public.qa_learning_scenarios (
  id uuid primary key default gen_random_uuid(),
  scenario_hash text not null unique,
  source text not null default 'qa_inquiries',
  source_inquiry_id uuid references public.qa_inquiries(id) on delete set null,
  source_event_id uuid references public.platform_learning_events(id) on delete set null,
  source_critique_id uuid references public.critique_results(id) on delete set null,
  category text not null,
  destination_hint text,
  user_message_redacted text not null,
  expected_behavior jsonb not null default '{}'::jsonb,
  priority integer not null default 50,
  status text not null default 'pending' check (status in ('pending', 'active', 'archived')),
  auto_generated boolean not null default true,
  generated_reason text,
  last_run_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_qa_learning_scenarios_status_priority
  on public.qa_learning_scenarios (status, priority desc, created_at desc);

create index if not exists idx_qa_learning_scenarios_category_created
  on public.qa_learning_scenarios (category, created_at desc);

alter table public.qa_learning_scenarios enable row level security;

drop policy if exists "qa_learning_scenarios_service_role_all" on public.qa_learning_scenarios;
create policy "qa_learning_scenarios_service_role_all"
  on public.qa_learning_scenarios
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.qa_learning_scenarios from anon, authenticated;
grant all on table public.qa_learning_scenarios to service_role;

