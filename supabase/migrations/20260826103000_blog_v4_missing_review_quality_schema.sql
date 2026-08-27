-- Blog V4 recovery migration for environments whose historical migration replay
-- created the minimal review-case table but missed the quality/review evidence
-- objects. This is additive and preserves all existing rows.

begin;

create table if not exists public.blog_quality_evaluations (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid null references public.content_creatives(id) on delete cascade,
  queue_id uuid null references public.blog_topic_queue(id) on delete cascade,
  evaluator_version text not null default 'blog-quality-v3',
  passed boolean not null,
  score numeric(5,2) null check (score is null or score between 0 and 100),
  dimensions jsonb not null,
  failure_reasons jsonb not null default '[]'::jsonb,
  hard_blockers text[] not null default '{}'::text[],
  evaluated_at timestamptz not null default now(),
  constraint blog_quality_evaluation_target check (creative_id is not null or queue_id is not null)
);

alter table public.blog_information_review_cases
  -- Some legacy Yeosonam Preview schemas do not have public.tenants yet.
  -- Keep the nullable tenant identity additive; the tenant FK belongs in the
  -- tenant-schema migration and must not block Blog V4 evidence recovery.
  add column if not exists tenant_id uuid null,
  add column if not exists content_key text not null default '',
  add column if not exists intent_type text not null default 'unknown',
  add column if not exists validator_report jsonb not null default '{}'::jsonb,
  add column if not exists approved_by uuid null,
  add column if not exists approved_at timestamptz null;

create table if not exists public.blog_information_review_events (
  id uuid primary key default gen_random_uuid(),
  review_case_id uuid not null references public.blog_information_review_cases(id) on delete cascade,
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  action text not null check (action in (
    'research_validated', 'research_missing', 'approved', 'changes_requested',
    'rejected', 'publish_revalidated', 'published'
  )),
  actor_id uuid null,
  from_status text null,
  to_status text null,
  content_fingerprint char(64) not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  validator_report jsonb not null default '{}'::jsonb,
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.content_review_queue
  add column if not exists information_review_case_id uuid null
  references public.blog_information_review_cases(id) on delete cascade;

create index if not exists idx_blog_quality_evaluations_creative
  on public.blog_quality_evaluations (creative_id, evaluated_at desc);
create index if not exists idx_blog_quality_evaluations_queue
  on public.blog_quality_evaluations (queue_id, evaluated_at desc)
  where queue_id is not null;
create index if not exists idx_blog_information_review_events_case
  on public.blog_information_review_events (review_case_id, created_at desc);
create index if not exists idx_blog_information_review_events_creative
  on public.blog_information_review_events (creative_id);

alter table public.blog_quality_evaluations enable row level security;
alter table public.blog_information_review_cases enable row level security;
alter table public.blog_information_review_events enable row level security;
revoke all on public.blog_quality_evaluations, public.blog_information_review_cases, public.blog_information_review_events
  from public, anon, authenticated;
grant select, insert, update, delete on public.blog_quality_evaluations to service_role;
grant select, insert, update on public.blog_information_review_cases to service_role;
grant select, insert on public.blog_information_review_events to service_role;

drop policy if exists blog_quality_evaluations_service_role on public.blog_quality_evaluations;
create policy blog_quality_evaluations_service_role
  on public.blog_quality_evaluations for all to service_role using (true) with check (true);
drop policy if exists blog_information_review_cases_service_role on public.blog_information_review_cases;
create policy blog_information_review_cases_service_role
  on public.blog_information_review_cases for all to service_role using (true) with check (true);
drop policy if exists blog_information_review_events_service_role on public.blog_information_review_events;
create policy blog_information_review_events_service_role
  on public.blog_information_review_events for all to service_role using (true) with check (true);

comment on table public.blog_quality_evaluations is
  'Durable V3 quality evidence for Blog V4 candidates; never a publish bypass.';
comment on table public.blog_information_review_events is
  'Append-only review evidence for Blog V4 human review transitions.';

commit;
