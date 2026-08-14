-- Naver-first keyword demand and editorial-result research.
-- This migration is additive: the legacy serp_analysis/serp_snapshots readers
-- continue to work while V3 readers opt into the new columns and tables.
-- Keep this migration outside an explicit transaction because the index on the
-- existing serp_snapshots table must be built CONCURRENTLY in production.

create table if not exists public.blog_serp_research_runs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  query_normalized text not null,
  provider text not null check (provider in (
    'naver_search_api', 'naver_search_ads', 'naver_datalab',
    'google_search_console', 'serpapi_google', 'cache', 'fallback'
  )),
  engine text not null,
  locale text not null default 'ko-KR',
  device text not null default 'mobile' check (device in ('mobile', 'desktop', 'all')),
  mode text not null check (mode in ('fresh', 'cached', 'fallback_only', 'unavailable')),
  status text not null check (status in ('running', 'completed', 'partial', 'failed')),
  serp_features jsonb not null default '{}'::jsonb,
  people_also_ask jsonb not null default '[]'::jsonb,
  related_queries jsonb not null default '[]'::jsonb,
  demand_signals jsonb not null default '[]'::jsonb,
  expires_at timestamptz null,
  error_code text null,
  error_detail text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_keyword_demand_observations (
  id bigint generated always as identity primary key,
  research_run_id uuid null references public.blog_serp_research_runs(id) on delete set null,
  query text not null,
  query_normalized text not null,
  provider text not null check (provider in (
    'naver_search_ads', 'naver_datalab', 'google_search_console',
    'naver_search_advisor', 'customer_question', 'active_product_question',
    'operator_note', 'editor_seed'
  )),
  metric_name text not null check (metric_name in (
    'monthly_pc_searches', 'monthly_mobile_searches', 'monthly_total_searches',
    'relative_trend_index', 'clicks', 'impressions', 'ctr',
    'average_position', 'question_frequency', 'product_relevance'
  )),
  metric_value numeric not null check (metric_value >= 0),
  unit text not null check (unit in ('searches_per_month', 'relative_index_0_100', 'impressions_90d')),
  value_kind text not null check (value_kind in ('observed', 'provider_estimate', 'relative_index')),
  observed_from date null,
  observed_to date null,
  source_reference text not null,
  collected_at timestamptz not null default now(),
  expires_at timestamptz null,
  raw jsonb not null default '{}'::jsonb,
  unique (provider, query_normalized, metric_name, source_reference, collected_at)
);

alter table public.serp_snapshots
  add column if not exists research_run_id uuid null references public.blog_serp_research_runs(id) on delete set null,
  add column if not exists result_type text null,
  add column if not exists domain text null,
  add column if not exists is_editorial boolean null,
  add column if not exists original_rank integer null,
  add column if not exists published_at timestamptz null;

alter table public.serp_analysis
  add column if not exists intent text null,
  add column if not exists recommended_archetypes jsonb not null default '[]'::jsonb,
  add column if not exists structure_consensus jsonb not null default '[]'::jsonb,
  add column if not exists content_gaps jsonb not null default '[]'::jsonb,
  add column if not exists confidence numeric(5,4) null check (confidence is null or confidence between 0 and 1),
  add column if not exists analysis_version text not null default 'legacy';

create table if not exists public.blog_serp_page_observations (
  id bigint generated always as identity primary key,
  research_run_id uuid not null references public.blog_serp_research_runs(id) on delete cascade,
  serp_snapshot_id bigint null references public.serp_snapshots(id) on delete set null,
  rank integer not null check (rank > 0),
  url text not null,
  domain text not null,
  title text not null,
  fetch_status text not null check (fetch_status in ('ok', 'fetch_blocked', 'fetch_failed', 'non_editorial')),
  published_at timestamptz null,
  modified_at timestamptz null,
  heading_tree jsonb not null default '[]'::jsonb,
  structure_signature text null,
  opening_strategy text null,
  section_roles jsonb not null default '[]'::jsonb,
  body_characters integer null check (body_characters is null or body_characters >= 0),
  paragraph_count integer null check (paragraph_count is null or paragraph_count >= 0),
  list_count integer null check (list_count is null or list_count >= 0),
  table_count integer null check (table_count is null or table_count >= 0),
  image_count integer null check (image_count is null or image_count >= 0),
  image_observations jsonb not null default '[]'::jsonb,
  author_present boolean null,
  reviewer_present boolean null,
  source_link_count integer null check (source_link_count is null or source_link_count >= 0),
  schema_types text[] not null default '{}'::text[],
  internal_link_count integer null check (internal_link_count is null or internal_link_count >= 0),
  cta_types text[] not null default '{}'::text[],
  decision_resolved text null,
  unresolved_questions text[] not null default '{}'::text[],
  evidence_excerpt text null check (evidence_excerpt is null or char_length(evidence_excerpt) <= 600),
  fetched_at timestamptz not null default now(),
  unique (research_run_id, url)
);

create index if not exists idx_blog_serp_runs_query_created
  on public.blog_serp_research_runs(query_normalized, created_at desc);
create index if not exists idx_blog_serp_runs_mode_expiry
  on public.blog_serp_research_runs(mode, expires_at desc);
create index if not exists idx_blog_keyword_demand_query_collected
  on public.blog_keyword_demand_observations(query_normalized, collected_at desc);
create index if not exists idx_blog_keyword_demand_provider_metric
  on public.blog_keyword_demand_observations(provider, metric_name, collected_at desc);
create index if not exists idx_blog_keyword_demand_research_run
  on public.blog_keyword_demand_observations(research_run_id)
  where research_run_id is not null;
create index concurrently if not exists idx_serp_snapshots_research_run
  on public.serp_snapshots(research_run_id, original_rank);
create index if not exists idx_blog_serp_observations_run_rank
  on public.blog_serp_page_observations(research_run_id, rank);
create index if not exists idx_blog_serp_observations_snapshot
  on public.blog_serp_page_observations(serp_snapshot_id)
  where serp_snapshot_id is not null;
create index if not exists idx_blog_serp_observations_domain
  on public.blog_serp_page_observations(domain, fetched_at desc);

alter table public.blog_serp_research_runs enable row level security;
alter table public.blog_keyword_demand_observations enable row level security;
alter table public.blog_serp_page_observations enable row level security;

revoke all on table public.blog_serp_research_runs from public, anon, authenticated;
revoke all on table public.blog_keyword_demand_observations from public, anon, authenticated;
revoke all on table public.blog_serp_page_observations from public, anon, authenticated;
revoke all on sequence public.blog_keyword_demand_observations_id_seq from public, anon, authenticated;
revoke all on sequence public.blog_serp_page_observations_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.blog_serp_research_runs to service_role;
grant select, insert, update, delete on table public.blog_keyword_demand_observations to service_role;
grant select, insert, update, delete on table public.blog_serp_page_observations to service_role;
grant usage, select on sequence public.blog_keyword_demand_observations_id_seq to service_role;
grant usage, select on sequence public.blog_serp_page_observations_id_seq to service_role;

drop policy if exists blog_serp_research_runs_service_role_all on public.blog_serp_research_runs;
create policy blog_serp_research_runs_service_role_all
  on public.blog_serp_research_runs for all to service_role using (true) with check (true);
drop policy if exists blog_keyword_demand_observations_service_role_all on public.blog_keyword_demand_observations;
create policy blog_keyword_demand_observations_service_role_all
  on public.blog_keyword_demand_observations for all to service_role using (true) with check (true);
drop policy if exists blog_serp_page_observations_service_role_all on public.blog_serp_page_observations;
create policy blog_serp_page_observations_service_role_all
  on public.blog_serp_page_observations for all to service_role using (true) with check (true);

comment on table public.blog_serp_research_runs is
  'Provider-aware SERP research runs. Naver Search API is the default; paid Google SERP is optional.';
comment on table public.blog_keyword_demand_observations is
  'Observed provider metrics only. DataLab values remain relative indexes and are never converted to search volume.';
comment on table public.blog_serp_page_observations is
  'Compact editorial structure fingerprints and short evidence excerpts; competitor full bodies are not stored.';
