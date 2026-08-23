-- Blog V4 staging-only legacy schema baseline.
--
-- Supabase Branching 2.0 can create an empty database when the main project
-- does not have a complete migration history. This file is intentionally kept
-- outside supabase/migrations so it can never enter a production db push.
-- It contains schema only and no customer or production rows.

create table if not exists public.content_creatives (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  product_id uuid,
  angle_type text default 'emotional'::text not null,
  target_audience text,
  channel text default 'instagram_card'::text not null,
  image_ratio text default '1:1',
  slides jsonb default '[]'::jsonb,
  blog_html text,
  ad_copy jsonb,
  tracking_id text,
  tone text default 'professional'::text,
  extra_prompt text,
  status text default 'draft'::text,
  published_at timestamptz,
  slug text,
  seo_title text,
  seo_description text,
  og_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  category varchar(50),
  prompt_version varchar(20),
  ai_model varchar(50),
  ai_temperature numeric(3,2),
  sub_keyword varchar(100),
  generation_params jsonb,
  category_id uuid,
  publish_scheduled_at timestamptz,
  view_count integer default 0 not null,
  quality_gate jsonb default '{}'::jsonb,
  topic_source text,
  generation_meta jsonb default '{}'::jsonb,
  destination text,
  target_ad_keywords text[] default '{}'::text[],
  landing_headline text,
  landing_subtitle text,
  landing_enabled boolean default false not null,
  featured boolean default false not null,
  featured_order integer,
  content_type text default 'guide'::text,
  pillar_for text,
  readability_score numeric(5,2),
  readability_issues jsonb default '[]'::jsonb,
  source text default 'manual'::text,
  band_post_url text,
  review_status text default 'none'::text,
  cta_text text default '자세히 보기'::text,
  seo_score jsonb,
  metrics jsonb default '{}'::jsonb not null,
  title text,
  description text,
  content_document jsonb,
  content_modified_at timestamptz,
  fact_checked_at timestamptz,
  last_verified_at timestamptz,
  material_update_reason text,
  author_profile_id uuid
);

create table if not exists public.blog_information_representatives (
  representative_key text not null unique,
  destination_id text not null,
  intent text not null,
  audience text not null,
  locale text not null,
  canonical_creative_id uuid,
  canonical_slug text,
  status text default 'reserved'::text not null,
  reservation_owner text not null,
  reserved_at timestamptz default now() not null,
  activated_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  reservation_expires_at timestamptz
);

create table if not exists public.blog_topic_queue (
  id uuid default gen_random_uuid() not null primary key,
  topic text not null,
  source text not null,
  priority integer default 50 not null,
  destination text,
  angle_type text,
  product_id uuid,
  category text,
  target_publish_at timestamptz,
  status text default 'queued'::text not null,
  attempts integer default 0 not null,
  last_error text,
  content_creative_id uuid,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  card_news_id uuid,
  tenant_id uuid,
  primary_keyword text,
  keyword_tier text,
  monthly_search_volume integer,
  competition_level text,
  trend_score numeric(5,2),
  content_lane text default 'informational'::text
);

create table if not exists public.blog_generation_runs (
  id uuid default gen_random_uuid() not null primary key,
  queue_id uuid not null,
  tenant_id uuid,
  agent_task_id uuid,
  content_creative_id uuid,
  generation_key text not null,
  orchestrator_version text default 'blog-deepseek-orchestrator-v4'::text not null,
  status text default 'queued'::text not null,
  attempt_count integer default 0 not null,
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
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.blog_generation_attempts (
  id uuid default gen_random_uuid() not null primary key,
  run_id uuid not null,
  queue_id uuid not null,
  attempt_number integer not null,
  stage text not null,
  provider text not null,
  model text not null,
  thinking_mode text not null,
  prompt_hash text,
  research_fingerprint text,
  claim_fingerprint text,
  output_hash text not null,
  output_document jsonb not null,
  input_tokens bigint,
  cache_hit_input_tokens bigint,
  cache_miss_input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric(14,8),
  pricing_tier text,
  pricing_version text,
  quality_score_before numeric(6,2),
  quality_score_after numeric(6,2),
  hard_blockers jsonb default '[]'::jsonb not null,
  failure_reasons jsonb default '[]'::jsonb not null,
  route text not null,
  latency_ms integer,
  status text default 'completed'::text not null,
  error_code text,
  started_at timestamptz default now() not null,
  completed_at timestamptz,
  created_at timestamptz default now() not null,
  finish_reason text
);

create table if not exists public.blog_indexing_jobs (
  id uuid default gen_random_uuid() not null primary key,
  content_creative_id uuid,
  slug text not null,
  url text not null,
  source text default 'publish'::text not null,
  type text default 'URL_UPDATED'::text not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  max_attempts integer default 6 not null,
  next_attempt_at timestamptz default now() not null,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  last_report jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  succeeded_at timestamptz,
  idempotency_key text
);

create table if not exists public.blog_demand_signals (
  id uuid default gen_random_uuid() not null primary key,
  queue_id uuid,
  creative_id uuid,
  provider text not null,
  signal_key text not null,
  signal_value numeric,
  source_reference text not null,
  observed_at timestamptz not null,
  expires_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  unique (provider, signal_key, source_reference)
);

create table if not exists public.blog_publication_rollout_state (
  scope text not null primary key,
  stage text default 'pilot_3'::text not null,
  status text default 'active'::text not null,
  healthy_window_streak integer default 0 not null,
  unhealthy_window_streak integer default 0 not null,
  publications_since_stage_started integer default 0 not null,
  stage_started_at timestamptz default now() not null,
  last_window_key date,
  last_evaluated_at timestamptz,
  frozen_at timestamptz,
  freeze_reason text,
  state_version bigint default 1 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.blog_information_sources (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  source_key text not null unique,
  site_scope text default 'www.yeosonam.com'::text not null,
  tenant_scope_key text generated always as (
    coalesce(tenant_id::text, 'public') || ':' || lower(site_scope)
  ) stored,
  source_type text not null,
  authority_level text not null,
  source_url text,
  internal_identifier text,
  publisher text not null,
  retrieved_at timestamptz not null,
  valid_from timestamptz,
  valid_until timestamptz,
  destination text,
  country text,
  claim_types text[] default '{}'::text[] not null,
  risk_level text default 'LOW'::text not null,
  reviewer_id uuid,
  reviewed_at timestamptz,
  status text default 'active'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  official_source_registry_id uuid,
  unique (tenant_scope_key, source_key)
);

create table if not exists public.blog_information_source_versions (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  source_id uuid not null,
  site_scope text default 'www.yeosonam.com'::text not null,
  version_key char(64) not null,
  content_hash char(64) not null,
  snapshot_content text,
  source_type text not null,
  authority_level text not null,
  source_url text,
  internal_identifier text,
  publisher text not null,
  retrieved_at timestamptz not null,
  valid_from timestamptz,
  valid_until timestamptz,
  destination text,
  country text,
  claim_types text[] default '{}'::text[] not null,
  risk_level text default 'LOW'::text not null,
  reviewer_id uuid,
  reviewed_at timestamptz,
  status text default 'active'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  official_source_registry_id uuid,
  unique (source_id, version_key)
);

create table if not exists public.blog_information_evidence (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  content_key text not null,
  creative_id uuid,
  source_id uuid not null,
  source_version_id uuid,
  evidence_key text not null,
  logical_evidence_key text,
  source_locator text,
  excerpt text,
  span_start integer,
  span_end integer,
  claim_type text not null,
  risk_level text default 'LOW'::text not null,
  observed_at timestamptz not null,
  valid_from timestamptz,
  valid_until timestamptz,
  scope jsonb default '{}'::jsonb not null,
  captured_by text default 'information_researcher'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (content_key, evidence_key),
  unique (content_key, logical_evidence_key, source_version_id)
);

create table if not exists public.blog_information_claims (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  content_key text not null,
  creative_id uuid,
  claim_fingerprint char(64) not null,
  claim_text text not null,
  claim_type text not null,
  risk_level text default 'LOW'::text not null,
  extracted_value jsonb default '{}'::jsonb not null,
  requires_evidence boolean default true not null,
  validation_status text default 'pending'::text not null,
  validation_reason text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (content_key, claim_fingerprint)
);

create table if not exists public.blog_information_claim_evidence (
  claim_id uuid not null,
  evidence_id uuid not null,
  support_type text default 'supports'::text not null,
  note text,
  created_at timestamptz default now() not null,
  primary key (claim_id, evidence_id)
);

create table if not exists public.blog_information_claim_ledger_v3 (
  claim_id uuid,
  claim_text text,
  claim_type text,
  risk_level text,
  source_url text,
  source_domain text,
  source_type text,
  source_title text,
  source_published_at timestamptz,
  retrieved_at timestamptz,
  effective_from timestamptz,
  expires_at timestamptz,
  evidence_excerpt text,
  verification_status text,
  conflict_status text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  creative_id uuid,
  content_key text
);

create table if not exists public.blog_publication_decisions (
  id uuid default gen_random_uuid() not null primary key,
  creative_id uuid not null,
  queue_id uuid,
  policy_version text default 'blog-quality-v3'::text not null,
  autopublish_mode text not null,
  decision text not null,
  gate_evidence jsonb default '{}'::jsonb not null,
  reasons text[] default '{}'::text[] not null,
  decided_at timestamptz default now() not null
);

create table if not exists public.agent_tasks (
  id uuid default gen_random_uuid() not null primary key,
  tenant_id uuid,
  source text,
  agent_type text,
  specialist_id text,
  performative text,
  risk_level text,
  status text default 'pending'::text not null,
  task_context jsonb default '{}'::jsonb,
  idempotency_key text unique,
  created_by text,
  started_at timestamptz,
  result_payload jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.blog_search_performance (
  id uuid default gen_random_uuid() not null primary key,
  provider text,
  metric_date date,
  query text,
  page_url text,
  clicks integer default 0,
  impressions integer default 0,
  ctr numeric,
  average_position numeric,
  imported_at timestamptz default now(),
  source_row_hash text
);

create table if not exists public.blog_ai_budget_reservations (
  id uuid default gen_random_uuid() not null primary key,
  budget_day_kst date not null,
  queue_id uuid not null,
  attempt_number integer not null,
  stage text not null,
  provider text not null,
  model text not null,
  cap_usd numeric(12,8) not null,
  requested_usd numeric(12,8) not null,
  reserved_usd numeric(12,8) not null,
  actual_usd numeric(12,8) default 0 not null,
  status text default 'reserved'::text not null,
  receipt jsonb default '{}'::jsonb not null,
  settled_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (queue_id, attempt_number)
);

create or replace function public.reserve_blog_ai_budget_v4(
  p_queue_id uuid,
  p_attempt_number integer,
  p_stage text,
  p_provider text,
  p_model text,
  p_requested_usd numeric,
  p_cap_usd numeric,
  p_budget_day_kst date
) returns table (
  reservation_id uuid,
  allowed boolean,
  reason text,
  cap_usd numeric,
  actual_usd numeric,
  reserved_usd numeric,
  requested_usd numeric,
  remaining_usd numeric
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.blog_ai_budget_reservations%rowtype;
  v_actual numeric := 0;
  v_reserved numeric := 0;
begin
  if p_requested_usd <= 0 or p_cap_usd <= 0
    or p_attempt_number not between 1 and 3
    or p_provider <> 'deepseek'
    or p_stage not in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max') then
    raise exception 'invalid_blog_ai_budget_reservation';
  end if;
  select * into v_existing
  from public.blog_ai_budget_reservations
  where queue_id = p_queue_id and attempt_number = p_attempt_number;
  select coalesce(sum(r.actual_usd), 0), coalesce(sum(r.reserved_usd), 0)
  into v_actual, v_reserved
  from public.blog_ai_budget_reservations r
  where r.budget_day_kst = p_budget_day_kst;
  if v_existing.id is not null then
    return query select v_existing.id, false, 'attempt_budget_already_reserved'::text,
      least(p_cap_usd, v_existing.cap_usd), v_actual, v_reserved,
      v_existing.requested_usd,
      greatest(0::numeric, least(p_cap_usd, v_existing.cap_usd) - v_actual - v_reserved);
    return;
  end if;
  if v_actual + v_reserved + p_requested_usd > p_cap_usd then
    return query select null::uuid, false, 'daily_ai_cost_cap_reached'::text,
      p_cap_usd, v_actual, v_reserved, p_requested_usd,
      greatest(0::numeric, p_cap_usd - v_actual - v_reserved);
    return;
  end if;
  insert into public.blog_ai_budget_reservations (
    budget_day_kst, queue_id, attempt_number, stage, provider, model,
    cap_usd, requested_usd, reserved_usd
  ) values (
    p_budget_day_kst, p_queue_id, p_attempt_number, p_stage, p_provider, p_model,
    p_cap_usd, p_requested_usd, p_requested_usd
  ) returning id into reservation_id;
  allowed := true;
  reason := 'budget_reserved';
  cap_usd := p_cap_usd;
  actual_usd := v_actual;
  reserved_usd := v_reserved + p_requested_usd;
  requested_usd := p_requested_usd;
  remaining_usd := greatest(0::numeric, p_cap_usd - actual_usd - reserved_usd);
  return next;
end;
$$;

create or replace function public.settle_blog_ai_budget_v4(
  p_reservation_id uuid,
  p_actual_usd numeric,
  p_receipt jsonb,
  p_status text,
  p_retain_reservation boolean default false
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed')
    or (p_actual_usd is not null and p_actual_usd < 0) then
    raise exception 'invalid_blog_ai_budget_settlement';
  end if;
  update public.blog_ai_budget_reservations
  set actual_usd = coalesce(p_actual_usd, actual_usd),
      reserved_usd = case when p_retain_reservation or p_actual_usd is null then reserved_usd else 0 end,
      receipt = coalesce(p_receipt, '{}'::jsonb), status = p_status,
      settled_at = now(), updated_at = now()
  where id = p_reservation_id;
  if not found then raise exception 'blog_ai_budget_reservation_missing'; end if;
end;
$$;

create table if not exists public.blog_information_official_source_registry (
  id uuid default gen_random_uuid() not null primary key,
  hostname text not null,
  source_type text not null,
  authority_level text not null,
  allow_subdomains boolean default false not null,
  status text default 'active'::text not null,
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  review_note text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (hostname, source_type)
);

create table if not exists public.blog_information_review_cases (
  id uuid default gen_random_uuid() not null primary key,
  creative_id uuid not null,
  content_fingerprint text not null,
  risk_level text not null,
  status text default 'pending'::text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Minimal empty relation targets required to compile the commercial branch of
-- the V4 RPCs. The staging canary never inserts commercial rows.
create table if not exists public.travel_packages (
  id uuid default gen_random_uuid() not null primary key,
  title text,
  destination text,
  product_revision bigint default 1 not null,
  publication_state text default 'draft'::text not null,
  catalog_product_id uuid
);

create table if not exists public.public_package_snapshots (
  id uuid default gen_random_uuid() not null primary key,
  package_id uuid not null,
  package_revision bigint default 1 not null,
  snapshot_hash text,
  snapshot_json jsonb default '{}'::jsonb,
  status text default 'draft'::text not null,
  locale text default 'ko-KR'::text not null,
  catalog_product_id uuid
);

create table if not exists public.product_registration_v5_publication_pointers (
  package_id uuid not null,
  channel text default 'customer'::text not null,
  locale text default 'ko-KR'::text not null,
  current_revision_id uuid,
  current_snapshot_id uuid,
  state text default 'draft'::text not null,
  primary key (package_id, channel, locale)
);
