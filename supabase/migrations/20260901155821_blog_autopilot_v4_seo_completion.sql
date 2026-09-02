begin;

create table if not exists public.blog_seo_audit_runs (
  id uuid primary key default gen_random_uuid(),
  audit_key text not null unique,
  audit_version text not null,
  scope text not null default 'weekly' check (scope in ('shadow', 'weekly', 'manual', 'release')),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  target_count integer not null default 0 check (target_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  pipeline_version text not null,
  deployment_commit_sha text not null,
  schema_migration_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_seo_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.blog_seo_audit_runs(id) on delete restrict,
  content_creative_id uuid references public.content_creatives(id) on delete set null,
  slug text not null,
  url text not null,
  observed_at timestamptz not null default now(),
  http_status integer check (http_status is null or http_status between 100 and 599),
  canonical_url text,
  robots_directive text,
  title text,
  description text,
  h1_count smallint check (h1_count is null or h1_count >= 0),
  schema_types text[] not null default '{}',
  sitemap_included boolean,
  render_hash text,
  metadata_hash text,
  gsc_observation jsonb not null default '{}'::jsonb,
  crux_observation jsonb not null default '{}'::jsonb,
  pagespeed_observation jsonb not null default '{}'::jsonb,
  provider_receipts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, url)
);

create table if not exists public.blog_seo_audit_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.blog_seo_audit_runs(id) on delete restrict,
  observation_id uuid references public.blog_seo_observations(id) on delete restrict,
  content_creative_id uuid references public.content_creatives(id) on delete set null,
  url text,
  category text not null check (category in (
    'technical', 'metadata_drift', 'render_drift', 'cannibalization',
    'content_decay', 'gsc', 'crux', 'pagespeed', 'source_adapter', 'semantic_duplicate'
  )),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  code text not null,
  action text not null default 'review' check (action in ('none', 'review', 'repair_queue', 'freeze')),
  status text not null default 'open' check (status in ('open', 'queued', 'resolved', 'dismissed')),
  fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (run_id, fingerprint)
);

create table if not exists public.blog_adapter_benchmarks (
  id uuid primary key default gen_random_uuid(),
  adapter text not null check (adapter in ('crawl4ai', 'docling', 'korean_semantic')),
  adapter_version text not null,
  benchmark_version text not null,
  corpus_hash text not null,
  sample_size integer not null check (sample_size >= 0),
  extraction_success_count integer check (extraction_success_count is null or extraction_success_count >= 0),
  factual_fidelity_count integer check (factual_fidelity_count is null or factual_fidelity_count >= 0),
  precision numeric(6,5) check (precision is null or precision between 0 and 1),
  recall numeric(6,5) check (recall is null or recall between 0 and 1),
  ssrf_security_passed boolean,
  latency_p95_ms integer check (latency_p95_ms is null or latency_p95_ms >= 0),
  passed boolean not null,
  metrics jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  deployment_commit_sha text not null,
  created_at timestamptz not null default now(),
  unique (adapter, adapter_version, corpus_hash)
);

create index if not exists idx_blog_seo_audit_runs_recent
  on public.blog_seo_audit_runs(started_at desc);
create index if not exists idx_blog_seo_observations_url
  on public.blog_seo_observations(url, observed_at desc);
create index if not exists idx_blog_seo_observations_slug
  on public.blog_seo_observations(slug, observed_at desc);
create index if not exists idx_blog_seo_observations_content_creative
  on public.blog_seo_observations(content_creative_id);
create index if not exists idx_blog_seo_findings_open
  on public.blog_seo_audit_findings(severity, created_at desc)
  where status in ('open', 'queued');
create index if not exists idx_blog_seo_findings_observation
  on public.blog_seo_audit_findings(observation_id);
create index if not exists idx_blog_seo_findings_content_creative
  on public.blog_seo_audit_findings(content_creative_id);
create index if not exists idx_blog_adapter_benchmarks_active
  on public.blog_adapter_benchmarks(adapter, evaluated_at desc)
  where passed = true;

alter table public.blog_seo_audit_runs enable row level security;
alter table public.blog_seo_observations enable row level security;
alter table public.blog_seo_audit_findings enable row level security;
alter table public.blog_adapter_benchmarks enable row level security;

revoke all on table
  public.blog_seo_audit_runs,
  public.blog_seo_observations,
  public.blog_seo_audit_findings,
  public.blog_adapter_benchmarks
from public, anon, authenticated;

grant select, insert, update on table public.blog_seo_audit_runs to service_role;
grant select, insert on table
  public.blog_seo_observations,
  public.blog_seo_audit_findings,
  public.blog_adapter_benchmarks
to service_role;

create policy blog_seo_audit_runs_service_select
  on public.blog_seo_audit_runs for select to service_role using (true);
create policy blog_seo_audit_runs_service_insert
  on public.blog_seo_audit_runs for insert to service_role with check (true);
create policy blog_seo_audit_runs_service_update
  on public.blog_seo_audit_runs for update to service_role using (true) with check (true);

create policy blog_seo_observations_service_select
  on public.blog_seo_observations for select to service_role using (true);
create policy blog_seo_observations_service_insert
  on public.blog_seo_observations for insert to service_role with check (true);
create policy blog_seo_audit_findings_service_select
  on public.blog_seo_audit_findings for select to service_role using (true);
create policy blog_seo_audit_findings_service_insert
  on public.blog_seo_audit_findings for insert to service_role with check (true);
create policy blog_adapter_benchmarks_service_select
  on public.blog_adapter_benchmarks for select to service_role using (true);
create policy blog_adapter_benchmarks_service_insert
  on public.blog_adapter_benchmarks for insert to service_role with check (true);

comment on table public.blog_seo_audit_runs is
  'Durable weekly/shadow/release SEO audit ledger. One deterministic audit_key prevents duplicate runs.';
comment on table public.blog_seo_observations is
  'Append-only public URL, GSC, CrUX, PageSpeed, metadata, and render observations. Provider receipts are immutable evidence.';
comment on table public.blog_seo_audit_findings is
  'Derived technical SEO, drift, cannibalization, and decay findings. Findings never directly unpublish or rewrite content.';
comment on table public.blog_adapter_benchmarks is
  'Activation evidence for Crawl4AI, Docling, and Korean semantic duplicate adapters. Runtime adapters fail closed without a passing row.';

commit;
