-- Ad OS V41-V60 enterprise hardening.
-- Adds platform jobs, conversion upload jobs, portfolio plans, creative variants,
-- travel intent signals, data-quality snapshots, and tenant billing profiles.
-- External spend remains guarded by change requests, tenant policies, and kill switches.

ALTER TABLE public.ad_os_automation_runs
  DROP CONSTRAINT IF EXISTS ad_os_automation_runs_run_type_check,
  ADD CONSTRAINT ad_os_automation_runs_run_type_check
  CHECK (run_type IN (
    'analysis',
    'candidate_generation',
    'budget_pacing',
    'bid_optimization',
    'search_term_harvest',
    'expiry_cleanup',
    'full_autopilot',
    'visibility_check',
    'performance_sync',
    'learning_apply',
    'external_publish',
    'publisher_probe',
    'experiment_plan',
    'tenant_report',
    'conversion_ingest',
    'creative_draft',
    'keyword_brain',
    'external_asset_plan',
    'platform_job',
    'conversion_upload',
    'portfolio_plan',
    'data_quality',
    'creative_asset_group',
    'tenant_workspace'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_platform_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  job_type text NOT NULL CHECK (job_type IN (
    'create_campaign',
    'create_business_channel',
    'create_ad_group',
    'create_paused_keyword',
    'activate_keyword',
    'pause_keyword',
    'update_bid',
    'upload_conversion',
    'sync_asset',
    'dry_run'
  )),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned',
    'approved',
    'running',
    'succeeded',
    'failed',
    'rolled_back',
    'blocked'
  )),
  automation_level integer NOT NULL DEFAULT 2 CHECK (automation_level >= 0 AND automation_level <= 5),
  change_request_id uuid NULL REFERENCES public.ad_os_change_requests(id) ON DELETE SET NULL,
  external_mutation_result_id uuid NULL REFERENCES public.ad_os_external_mutation_results(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  external_account_id text NULL,
  external_campaign_id text NULL,
  external_ad_group_id text NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrail_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrail_status text NOT NULL DEFAULT 'pending' CHECK (guardrail_status IN ('pending', 'passed', 'blocked')),
  external_api_write boolean NOT NULL DEFAULT false,
  blocked_reason text NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at timestamptz NULL,
  approved_by uuid NULL,
  applied_by uuid NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_platform_jobs_status
  ON public.ad_os_platform_jobs(platform, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_platform_jobs_tenant
  ON public.ad_os_platform_jobs(tenant_id, status, created_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_platform_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_platform_jobs_service" ON public.ad_os_platform_jobs;
CREATE POLICY "ad_os_platform_jobs_service"
  ON public.ad_os_platform_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_conversion_upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('google', 'meta')),
  conversion_event_id uuid NULL REFERENCES public.ad_os_conversion_events(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned',
    'approved',
    'running',
    'uploaded',
    'failed',
    'blocked'
  )),
  upload_type text NOT NULL DEFAULT 'offline_conversion' CHECK (upload_type IN (
    'offline_conversion',
    'enhanced_conversion',
    'meta_capi'
  )),
  idempotency_key text NOT NULL,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  value_krw integer NOT NULL DEFAULT 0 CHECK (value_krw >= 0),
  margin_krw integer NOT NULL DEFAULT 0,
  consent_status text NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('granted', 'denied', 'unknown')),
  signal_quality_score numeric NOT NULL DEFAULT 0 CHECK (signal_quality_score >= 0 AND signal_quality_score <= 100),
  blocked_reason text NULL,
  identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  upload_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_upload_id text NULL,
  created_by uuid NULL,
  applied_by uuid NULL,
  uploaded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_conversion_upload_jobs_status
  ON public.ad_os_conversion_upload_jobs(platform, status, created_at DESC);

ALTER TABLE public.ad_os_conversion_upload_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_conversion_upload_jobs_service" ON public.ad_os_conversion_upload_jobs;
CREATE POLICY "ad_os_conversion_upload_jobs_service"
  ON public.ad_os_conversion_upload_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_data_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  status text NOT NULL DEFAULT 'warning' CHECK (status IN ('healthy', 'warning', 'blocked')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  events_total integer NOT NULL DEFAULT 0 CHECK (events_total >= 0),
  clean_events integer NOT NULL DEFAULT 0 CHECK (clean_events >= 0),
  quarantined_events integer NOT NULL DEFAULT 0 CHECK (quarantined_events >= 0),
  upload_ready_events integer NOT NULL DEFAULT 0 CHECK (upload_ready_events >= 0),
  blocked_upload_events integer NOT NULL DEFAULT 0 CHECK (blocked_upload_events >= 0),
  duplicate_dedupe_keys integer NOT NULL DEFAULT 0 CHECK (duplicate_dedupe_keys >= 0),
  attribution_coverage_pct numeric NOT NULL DEFAULT 0 CHECK (attribution_coverage_pct >= 0 AND attribution_coverage_pct <= 100),
  margin_coverage_pct numeric NOT NULL DEFAULT 0 CHECK (margin_coverage_pct >= 0 AND margin_coverage_pct <= 100),
  blocked_by_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_data_quality_snapshots_status
  ON public.ad_os_data_quality_snapshots(status, created_at DESC);

ALTER TABLE public.ad_os_data_quality_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_data_quality_snapshots_service" ON public.ad_os_data_quality_snapshots;
CREATE POLICY "ad_os_data_quality_snapshots_service"
  ON public.ad_os_data_quality_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_portfolio_budget_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  plan_type text NOT NULL CHECK (plan_type IN (
    'pause_waste',
    'scale_winner',
    'reduce_deadline_risk',
    'landing_repair',
    'creative_refresh',
    'holdout_required'
  )),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'applied', 'rejected', 'expired')),
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  primary_metric text NOT NULL DEFAULT 'margin_roas',
  current_budget_krw integer NOT NULL DEFAULT 0 CHECK (current_budget_krw >= 0),
  recommended_budget_krw integer NOT NULL DEFAULT 0 CHECK (recommended_budget_krw >= 0),
  recommended_bid_adjustment_pct numeric NOT NULL DEFAULT 0,
  expected_margin_krw integer NOT NULL DEFAULT 0,
  expected_cpa_krw integer NOT NULL DEFAULT 0 CHECK (expected_cpa_krw >= 0),
  expected_margin_roas_pct numeric NOT NULL DEFAULT 0,
  deadline_risk_score numeric NOT NULL DEFAULT 0 CHECK (deadline_risk_score >= 0 AND deadline_risk_score <= 100),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reason text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_portfolio_budget_plans_idempotency
  ON public.ad_os_portfolio_budget_plans(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ad_os_portfolio_budget_plans_status
  ON public.ad_os_portfolio_budget_plans(status, platform, confidence DESC, created_at DESC);

ALTER TABLE public.ad_os_portfolio_budget_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_portfolio_budget_plans_service" ON public.ad_os_portfolio_budget_plans;
CREATE POLICY "ad_os_portfolio_budget_plans_service"
  ON public.ad_os_portfolio_budget_plans
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_creative_asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  asset_type text NOT NULL CHECK (asset_type IN (
    'rsa_headline',
    'dki_headline',
    'blog_cta_block',
    'blog_faq_block',
    'card_news_5',
    'card_news_7',
    'card_news_10',
    'meta_hook',
    'instagram_carousel',
    'short_form_storyboard',
    'retargeting_message'
  )),
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft', 'approved', 'testing', 'winner', 'fatigued', 'archived')),
  angle text NOT NULL DEFAULT 'general',
  audience text NOT NULL DEFAULT 'general',
  headline text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  cta text NOT NULL DEFAULT '',
  destination_url text NULL,
  fatigue_score numeric NOT NULL DEFAULT 0 CHECK (fatigue_score >= 0 AND fatigue_score <= 100),
  ctr_decay_pct numeric NOT NULL DEFAULT 0,
  cpa_trend_pct numeric NOT NULL DEFAULT 0,
  performance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_creative_asset_variants_idempotency
  ON public.ad_os_creative_asset_variants(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ad_os_creative_asset_variants_product
  ON public.ad_os_creative_asset_variants(product_id, lifecycle_status, created_at DESC)
  WHERE product_id IS NOT NULL;

ALTER TABLE public.ad_os_creative_asset_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_creative_asset_variants_service" ON public.ad_os_creative_asset_variants;
CREATE POLICY "ad_os_creative_asset_variants_service"
  ON public.ad_os_creative_asset_variants
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_travel_intent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  destination text NOT NULL DEFAULT '',
  intent_key text NOT NULL,
  intent_type text NOT NULL CHECK (intent_type IN (
    'departure_region',
    'airline',
    'family',
    'price',
    'comparison',
    'anxiety',
    'deadline',
    'differentiator',
    'seasonal',
    'retargeting'
  )),
  source text NOT NULL DEFAULT 'ad_os_travel_intent',
  keyword_text text NOT NULL DEFAULT '',
  landing_intent text NOT NULL DEFAULT 'product_landing',
  suggested_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (suggested_budget_cap_krw >= 0),
  suggested_bid_krw integer NOT NULL DEFAULT 0 CHECK (suggested_bid_krw >= 0),
  cannibalization_risk numeric NOT NULL DEFAULT 0 CHECK (cannibalization_risk >= 0 AND cannibalization_risk <= 100),
  duplicate_content_risk numeric NOT NULL DEFAULT 0 CHECK (duplicate_content_risk >= 0 AND duplicate_content_risk <= 100),
  score numeric NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'testing', 'active', 'rejected', 'expired')),
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, intent_key, keyword_text)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_travel_intent_signals_status
  ON public.ad_os_travel_intent_signals(status, intent_type, score DESC);

ALTER TABLE public.ad_os_travel_intent_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_travel_intent_signals_service" ON public.ad_os_travel_intent_signals;
CREATE POLICY "ad_os_travel_intent_signals_service"
  ON public.ad_os_travel_intent_signals
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_tenant_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  workspace_id uuid NULL REFERENCES public.tenant_ad_workspaces(id) ON DELETE SET NULL,
  billing_plan text NOT NULL DEFAULT 'pilot' CHECK (billing_plan IN ('internal', 'pilot', 'agency', 'enterprise')),
  base_subscription_krw integer NOT NULL DEFAULT 0 CHECK (base_subscription_krw >= 0),
  managed_spend_fee_pct numeric NOT NULL DEFAULT 0 CHECK (managed_spend_fee_pct >= 0),
  performance_fee_pct numeric NOT NULL DEFAULT 0 CHECK (performance_fee_pct >= 0),
  invoice_status text NOT NULL DEFAULT 'draft' CHECK (invoice_status IN ('draft', 'active', 'paused', 'cancelled')),
  audit_export_enabled boolean NOT NULL DEFAULT true,
  report_sla_days integer NOT NULL DEFAULT 7 CHECK (report_sla_days >= 0),
  data_retention_days integer NOT NULL DEFAULT 730 CHECK (data_retention_days >= 30),
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_tenant_billing_profiles_global
  ON public.ad_os_tenant_billing_profiles((tenant_id IS NULL))
  WHERE tenant_id IS NULL;

ALTER TABLE public.ad_os_tenant_billing_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_tenant_billing_profiles_service" ON public.ad_os_tenant_billing_profiles;
CREATE POLICY "ad_os_tenant_billing_profiles_service"
  ON public.ad_os_tenant_billing_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_platform_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_conversion_upload_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_data_quality_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_portfolio_budget_plans FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_creative_asset_variants FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_travel_intent_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_tenant_billing_profiles FROM anon, authenticated;
