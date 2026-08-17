-- Blog DeepSeek Orchestrator V4
-- Durable generation attempts and effective-dated provider pricing.
-- Additive and backward compatible. This migration does not mutate existing content.

create table if not exists public.blog_generation_runs (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.blog_topic_queue(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  agent_task_id uuid references public.agent_tasks(id) on delete set null,
  content_creative_id uuid references public.content_creatives(id) on delete set null,
  generation_key text not null,
  orchestrator_version text not null default 'blog-deepseek-orchestrator-v4',
  status text not null default 'queued'
    check (status in (
      'queued', 'generating', 'approved_for_slot', 'rewrite_pro_high', 'rewrite_pro_max',
      'reresearch', 'human_review', 'quarantine', 'publishing', 'published', 'failed', 'cancelled'
    )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  selected_attempt_id uuid,
  latest_quality_score numeric(6,2),
  disposition text,
  compute_after timestamptz,
  scheduled_publish_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  quarantined_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (queue_id, generation_key)
);

create table if not exists public.blog_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.blog_generation_runs(id) on delete cascade,
  queue_id uuid not null references public.blog_topic_queue(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 3),
  stage text not null check (stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max')),
  provider text not null check (provider = 'deepseek'),
  model text not null check (model in ('deepseek-v4-flash', 'deepseek-v4-pro')),
  thinking_mode text not null check (thinking_mode in ('disabled', 'enabled')),
  prompt_hash text,
  research_fingerprint text,
  claim_fingerprint text,
  output_hash text not null,
  output_document jsonb not null,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  cache_hit_input_tokens bigint check (cache_hit_input_tokens is null or cache_hit_input_tokens >= 0),
  cache_miss_input_tokens bigint check (cache_miss_input_tokens is null or cache_miss_input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(14,8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  pricing_tier text check (pricing_tier is null or pricing_tier in ('legacy', 'peak', 'offpeak')),
  pricing_version text,
  quality_score_before numeric(6,2),
  quality_score_after numeric(6,2),
  hard_blockers jsonb not null default '[]'::jsonb,
  failure_reasons jsonb not null default '[]'::jsonb,
  route text not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  status text not null default 'completed' check (status in ('started', 'completed', 'failed')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, attempt_number)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'blog_generation_runs_selected_attempt_fk'
      and conrelid = 'public.blog_generation_runs'::regclass
  ) then
    alter table public.blog_generation_runs
      add constraint blog_generation_runs_selected_attempt_fk
      foreign key (selected_attempt_id) references public.blog_generation_attempts(id) on delete set null;
  end if;
end $$;

create table if not exists public.ai_model_price_catalog (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  pricing_version text not null,
  pricing_tier text not null check (pricing_tier in ('legacy', 'peak', 'offpeak')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  peak_windows_utc jsonb not null default '[]'::jsonb,
  cache_hit_usd_per_million numeric(12,6) not null,
  cache_miss_usd_per_million numeric(12,6) not null,
  output_usd_per_million numeric(12,6) not null,
  source_url text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, model, pricing_version, pricing_tier)
);

create index if not exists idx_blog_generation_runs_status_compute
  on public.blog_generation_runs(status, compute_after, created_at);
create index if not exists idx_blog_generation_runs_publish_slot
  on public.blog_generation_runs(status, scheduled_publish_at)
  where status = 'approved_for_slot';
create index if not exists idx_blog_generation_runs_created_at
  on public.blog_generation_runs(created_at desc);
create index if not exists idx_blog_generation_runs_tenant
  on public.blog_generation_runs(tenant_id) where tenant_id is not null;
create index if not exists idx_blog_generation_runs_agent_task
  on public.blog_generation_runs(agent_task_id) where agent_task_id is not null;
create index if not exists idx_blog_generation_runs_creative
  on public.blog_generation_runs(content_creative_id) where content_creative_id is not null;
create index if not exists idx_blog_generation_runs_selected_attempt
  on public.blog_generation_runs(selected_attempt_id) where selected_attempt_id is not null;
create index if not exists idx_blog_generation_attempts_queue
  on public.blog_generation_attempts(queue_id, attempt_number desc);
create index if not exists idx_blog_generation_attempts_model_cost
  on public.blog_generation_attempts(model, completed_at desc);

insert into public.ai_model_price_catalog (
  provider, model, pricing_version, pricing_tier, effective_from, effective_to,
  peak_windows_utc, cache_hit_usd_per_million, cache_miss_usd_per_million,
  output_usd_per_million, source_url, verified_at
) values
  ('deepseek','deepseek-v4-flash','deepseek-2026-08-pre-transition','legacy','2026-01-01T00:00:00Z','2026-08-16T16:00:00Z','[]',0.0028,0.14,0.28,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z'),
  ('deepseek','deepseek-v4-pro','deepseek-2026-08-pre-transition','legacy','2026-01-01T00:00:00Z','2026-08-16T16:00:00Z','[]',0.003625,0.435,0.87,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z'),
  ('deepseek','deepseek-v4-flash','deepseek-2026-08-17','offpeak','2026-08-16T16:00:00Z',null,'[{"start":"01:00","end":"04:00"},{"start":"06:00","end":"10:00"}]',0.007,0.22,0.66,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z'),
  ('deepseek','deepseek-v4-flash','deepseek-2026-08-17','peak','2026-08-16T16:00:00Z',null,'[{"start":"01:00","end":"04:00"},{"start":"06:00","end":"10:00"}]',0.014,0.44,1.32,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z'),
  ('deepseek','deepseek-v4-pro','deepseek-2026-08-17','offpeak','2026-08-16T16:00:00Z',null,'[{"start":"01:00","end":"04:00"},{"start":"06:00","end":"10:00"}]',0.022,0.66,1.98,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z'),
  ('deepseek','deepseek-v4-pro','deepseek-2026-08-17','peak','2026-08-16T16:00:00Z',null,'[{"start":"01:00","end":"04:00"},{"start":"06:00","end":"10:00"}]',0.044,1.32,3.96,'https://api-docs.deepseek.com/quick_start/pricing','2026-08-15T00:00:00Z')
on conflict (provider, model, pricing_version, pricing_tier) do update set
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  peak_windows_utc = excluded.peak_windows_utc,
  cache_hit_usd_per_million = excluded.cache_hit_usd_per_million,
  cache_miss_usd_per_million = excluded.cache_miss_usd_per_million,
  output_usd_per_million = excluded.output_usd_per_million,
  source_url = excluded.source_url,
  verified_at = excluded.verified_at;

alter table public.blog_generation_runs enable row level security;
alter table public.blog_generation_attempts enable row level security;
alter table public.ai_model_price_catalog enable row level security;

revoke all on table public.blog_generation_runs, public.blog_generation_attempts, public.ai_model_price_catalog
  from public, anon, authenticated;
grant select, insert, update on table public.blog_generation_runs, public.blog_generation_attempts
  to service_role;
grant select on table public.ai_model_price_catalog to service_role;

drop policy if exists blog_generation_runs_service_role_all on public.blog_generation_runs;
drop policy if exists blog_generation_attempts_service_role_all on public.blog_generation_attempts;
drop policy if exists ai_model_price_catalog_service_role_select on public.ai_model_price_catalog;
create policy blog_generation_runs_service_role_all on public.blog_generation_runs
  for all to service_role using (true) with check (true);
create policy blog_generation_attempts_service_role_all on public.blog_generation_attempts
  for all to service_role using (true) with check (true);
create policy ai_model_price_catalog_service_role_select on public.ai_model_price_catalog
  for select to service_role using (true);

comment on table public.blog_generation_runs is
  'Durable DeepSeek-only blog generation state. Publication is a separate daytime action.';
comment on table public.blog_generation_attempts is
  'Immutable-by-contract model attempt evidence: output, gates, tokens, price tier and cost.';

-- Backfill dry-run (read-only):
-- select q.id, q.status, q.attempts, q.content_creative_id
-- from public.blog_topic_queue q
-- where q.status in ('queued','generating','pending_review')
-- order by q.created_at;
-- No historical attempt is fabricated. Existing rows begin a V4 run only on their next real model call.

-- Rollback (run manually only after application rollback):
-- drop table if exists public.blog_generation_attempts cascade;
-- drop table if exists public.blog_generation_runs cascade;
-- drop table if exists public.ai_model_price_catalog cascade;
