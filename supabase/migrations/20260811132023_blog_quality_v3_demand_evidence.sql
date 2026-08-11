-- Demand, claim freshness, corpus signatures, and explainable quality evidence.
begin;

create table if not exists public.blog_search_performance (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('google_search_console','naver_search_advisor')),
  metric_date date not null,
  query text not null,
  page_url text not null,
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  ctr numeric(8,7) not null default 0 check (ctr between 0 and 1),
  average_position numeric(8,3) null check (average_position is null or average_position >= 0),
  device text null,
  country text null,
  imported_at timestamptz not null default now(),
  source_batch_id text not null,
  source_row_hash char(64) not null,
  unique (provider, source_row_hash)
);

create table if not exists public.blog_demand_signals (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid null references public.blog_topic_queue(id) on delete cascade,
  creative_id uuid null references public.content_creatives(id) on delete cascade,
  provider text not null check (provider in (
    'google_search_console','naver_search_advisor','customer_question',
    'consultation_aggregate','active_product_question','operator_note',
    'editor_seed','search_volume','search_trend'
  )),
  signal_key text not null,
  signal_value numeric null,
  source_reference text not null,
  observed_at timestamptz not null,
  expires_at timestamptz null,
  verified_by uuid null,
  verified_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint blog_demand_signal_target check (queue_id is not null or creative_id is not null),
  constraint blog_demand_signal_verification_pair check (
    (verified_by is null and verified_at is null) or (verified_by is not null and verified_at is not null)
  ),
  unique(provider, signal_key, source_reference)
);

create table if not exists public.blog_content_signatures (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid null references public.content_creatives(id) on delete cascade,
  queue_id uuid null references public.blog_topic_queue(id) on delete cascade,
  representative_key text null,
  corpus_state text not null check (corpus_state in ('published','draft','queued','representative')),
  intent_key text null,
  exact_title_hash char(64) null,
  normalized_title text null,
  normalized_heading_tree text null,
  opening_hash char(64) null,
  first_three_hash char(64) null,
  sentence_5grams text[] not null default '{}'::text[],
  minhash_signature bigint[] not null default '{}'::bigint[],
  semantic_embedding extensions.vector(1536) null,
  cta_skeleton text null,
  image_urls text[] not null default '{}'::text[],
  image_phashes text[] not null default '{}'::text[],
  normalizer_version text not null default 'v3.0.0',
  created_at timestamptz not null default now(),
  constraint blog_content_signature_target check (
    num_nonnulls(creative_id, queue_id, representative_key) = 1
  )
);

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

alter table public.blog_information_sources
  add column if not exists source_title text null,
  add column if not exists source_domain text null,
  add column if not exists source_published_at timestamptz null;

alter table public.blog_information_source_versions
  add column if not exists source_title text null,
  add column if not exists source_domain text null,
  add column if not exists source_published_at timestamptz null;

alter table public.blog_information_claims
  add column if not exists effective_from timestamptz null,
  add column if not exists expires_at timestamptz null,
  add column if not exists conflict_status text not null default 'none'
    check (conflict_status in ('none','possible','confirmed','resolved'));

create or replace view public.blog_information_claim_ledger_v3
with (security_invoker = true)
as
select
  c.id as claim_id,
  c.claim_text,
  c.claim_type,
  c.risk_level,
  s.source_url,
  coalesce(v.source_domain, s.source_domain) as source_domain,
  coalesce(v.source_type, s.source_type) as source_type,
  coalesce(v.source_title, s.source_title) as source_title,
  coalesce(v.source_published_at, s.source_published_at) as source_published_at,
  coalesce(v.retrieved_at, s.retrieved_at) as retrieved_at,
  coalesce(c.effective_from, e.valid_from, v.valid_from, s.valid_from) as effective_from,
  coalesce(c.expires_at, e.valid_until, v.valid_until, s.valid_until) as expires_at,
  e.excerpt as evidence_excerpt,
  c.validation_status as verification_status,
  c.conflict_status,
  coalesce(c.approved_by, v.reviewer_id, s.reviewer_id) as reviewer_id,
  coalesce(c.approved_at, v.reviewed_at, s.reviewed_at) as reviewed_at,
  e.creative_id,
  c.content_key
from public.blog_information_claims c
left join public.blog_information_claim_evidence ce on ce.claim_id = c.id and ce.support_type = 'supports'
left join public.blog_information_evidence e on e.id = ce.evidence_id
left join public.blog_information_sources s on s.id = e.source_id
left join public.blog_information_source_versions v on v.id = e.source_version_id;

create index if not exists idx_blog_search_performance_query_date on public.blog_search_performance(query, metric_date desc);
create index if not exists idx_blog_search_performance_page_date on public.blog_search_performance(page_url, metric_date desc);
create index if not exists idx_blog_demand_signals_queue on public.blog_demand_signals(queue_id, observed_at desc);
create index if not exists idx_blog_demand_signals_creative on public.blog_demand_signals(creative_id, observed_at desc) where creative_id is not null;
create index if not exists idx_blog_content_signatures_title on public.blog_content_signatures(normalized_title);
create index if not exists idx_blog_content_signatures_intent on public.blog_content_signatures(intent_key, corpus_state);
create index if not exists idx_blog_content_signatures_creative on public.blog_content_signatures(creative_id) where creative_id is not null;
create index if not exists idx_blog_content_signatures_queue on public.blog_content_signatures(queue_id) where queue_id is not null;
create index if not exists idx_blog_quality_evaluations_creative on public.blog_quality_evaluations(creative_id, evaluated_at desc);
create index if not exists idx_blog_quality_evaluations_queue on public.blog_quality_evaluations(queue_id, evaluated_at desc) where queue_id is not null;

alter table public.blog_search_performance enable row level security;
alter table public.blog_demand_signals enable row level security;
alter table public.blog_content_signatures enable row level security;
alter table public.blog_quality_evaluations enable row level security;
revoke all on public.blog_search_performance, public.blog_demand_signals, public.blog_content_signatures, public.blog_quality_evaluations, public.blog_information_claim_ledger_v3 from public, anon, authenticated;
grant select, insert, update, delete on public.blog_search_performance, public.blog_demand_signals, public.blog_content_signatures, public.blog_quality_evaluations to service_role;
grant select on public.blog_information_claim_ledger_v3 to service_role;
create policy blog_search_performance_service_role on public.blog_search_performance for all to service_role using (true) with check (true);
create policy blog_demand_signals_service_role on public.blog_demand_signals for all to service_role using (true) with check (true);
create policy blog_content_signatures_service_role on public.blog_content_signatures for all to service_role using (true) with check (true);
create policy blog_quality_evaluations_service_role on public.blog_quality_evaluations for all to service_role using (true) with check (true);

comment on table public.blog_search_performance is 'Observed GSC/Naver query-page metrics only. Never store inferred search volume here.';
comment on table public.blog_demand_signals is 'Auditable, observed demand evidence; coverage_gap alone is not a signal.';
comment on view public.blog_information_claim_ledger_v3 is 'Claim-level source, freshness, conflict, and human-review projection.';

commit;
