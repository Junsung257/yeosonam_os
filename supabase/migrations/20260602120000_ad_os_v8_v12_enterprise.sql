-- Ad OS V8-V12: enterprise publisher, attribution, experiment, and SaaS packaging.
-- External spend remains guarded: these tables record decisions, events, and
-- workspaces; channel publishers must still pass budgets, tenant policy, and
-- kill-switch checks before any platform mutation.

ALTER TABLE public.ad_os_budget_pacing_snapshots
  DROP CONSTRAINT IF EXISTS ad_os_budget_pacing_snapshots_status_check,
  ADD CONSTRAINT ad_os_budget_pacing_snapshots_status_check
  CHECK (status IN (
    'no_budget',
    'on_track',
    'underspend',
    'overspend',
    'exhausted',
    'blocked',
    'under_pacing',
    'over_pacing',
    'loss_limit_near'
  ));

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
    'creative_draft'
  ));

ALTER TABLE public.ad_os_change_requests
  DROP CONSTRAINT IF EXISTS ad_os_change_requests_request_type_check,
  ADD CONSTRAINT ad_os_change_requests_request_type_check
  CHECK (request_type IN (
    'create_keyword',
    'pause_keyword',
    'increase_bid',
    'decrease_bid',
    'budget_change',
    'pause_channel',
    'replace_landing',
    'create_landing',
    'create_campaign',
    'sync_external_asset',
    'update_blog_cta',
    'create_card_news',
    'create_negative_keyword',
    'create_experiment',
    'publish_paused_keyword',
    'upload_conversion_signal'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'impression',
    'click',
    'landing_view',
    'cta_click',
    'lead',
    'booking',
    'revenue',
    'margin',
    'cancel',
    'settlement_confirmed'
  )),
  event_time timestamptz NOT NULL DEFAULT now(),
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  source text NOT NULL DEFAULT 'ad_os_conversion',
  session_id text NULL,
  visitor_id text NULL,
  click_id text NULL,
  gclid text NULL,
  gbraid text NULL,
  wbraid text NULL,
  naver_click_id text NULL,
  fbclid text NULL,
  utm_source text NULL,
  utm_medium text NULL,
  utm_campaign text NULL,
  utm_content text NULL,
  utm_term text NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  ad_landing_mapping_id uuid NULL REFERENCES public.ad_landing_mappings(id) ON DELETE SET NULL,
  content_creative_id uuid NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  ad_campaign_id uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  ad_creative_id uuid NULL REFERENCES public.ad_creatives(id) ON DELETE SET NULL,
  keyword_plan_id uuid NULL REFERENCES public.search_ad_keyword_plans(id) ON DELETE SET NULL,
  keyword_text text NULL,
  search_term text NULL,
  booking_id uuid NULL,
  revenue_krw integer NOT NULL DEFAULT 0 CHECK (revenue_krw >= 0),
  margin_krw integer NOT NULL DEFAULT 0,
  cost_krw integer NOT NULL DEFAULT 0 CHECK (cost_krw >= 0),
  is_test boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  is_bot boolean NOT NULL DEFAULT false,
  quarantine_status text NOT NULL DEFAULT 'clean' CHECK (quarantine_status IN ('clean', 'quarantined', 'review')),
  quality_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_conversion_events_tenant_time
  ON public.ad_os_conversion_events(tenant_id, event_time DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_conversion_events_product_time
  ON public.ad_os_conversion_events(product_id, event_time DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_conversion_events_clean
  ON public.ad_os_conversion_events(platform, event_type, event_time DESC)
  WHERE quarantine_status = 'clean';

ALTER TABLE public.ad_os_conversion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_conversion_events_service" ON public.ad_os_conversion_events;
CREATE POLICY "ad_os_conversion_events_service"
  ON public.ad_os_conversion_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_signal_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  conversion_event_id uuid NULL REFERENCES public.ad_os_conversion_events(id) ON DELETE CASCADE,
  source_table text NOT NULL DEFAULT 'ad_os_conversion_events',
  source_id text NOT NULL,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  excluded_from_learning boolean NOT NULL DEFAULT true,
  excluded_from_platform_upload boolean NOT NULL DEFAULT true,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'released', 'confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_signal_quarantine_status
  ON public.ad_os_signal_quarantine(status, severity, created_at DESC);

ALTER TABLE public.ad_os_signal_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_signal_quarantine_service" ON public.ad_os_signal_quarantine;
CREATE POLICY "ad_os_signal_quarantine_service"
  ON public.ad_os_signal_quarantine
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  experiment_type text NOT NULL CHECK (experiment_type IN (
    'holdout',
    'geo_split',
    'date_split',
    'landing_ab',
    'cta_ab',
    'keyword_match_type',
    'creative_ab',
    'bandit_candidate'
  )),
  name text NOT NULL,
  hypothesis text NOT NULL,
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  primary_metric text NOT NULL DEFAULT 'margin_roas',
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'running', 'paused', 'completed', 'rejected')),
  minimum_sample jsonb NOT NULL DEFAULT '{}'::jsonb,
  split_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_experiments_status
  ON public.ad_os_experiments(status, experiment_type, created_at DESC);

ALTER TABLE public.ad_os_experiments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_experiments_service" ON public.ad_os_experiments;
CREATE POLICY "ad_os_experiments_service"
  ON public.ad_os_experiments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_search_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google')),
  search_term text NOT NULL,
  parent_keyword text NULL,
  keyword_plan_id uuid NULL REFERENCES public.search_ad_keyword_plans(id) ON DELETE SET NULL,
  match_type text NULL,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_krw integer NOT NULL DEFAULT 0 CHECK (cost_krw >= 0),
  conversions numeric NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  revenue_krw integer NOT NULL DEFAULT 0 CHECK (revenue_krw >= 0),
  margin_krw integer NOT NULL DEFAULT 0,
  action text NOT NULL CHECK (action IN ('add_keyword', 'add_negative', 'review')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'applied', 'rejected', 'expired')),
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'ad_os_search_term_harvest',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, search_term, action)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_search_terms_status
  ON public.ad_os_search_terms(status, action, score DESC);

ALTER TABLE public.ad_os_search_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_search_terms_service" ON public.ad_os_search_terms;
CREATE POLICY "ad_os_search_terms_service"
  ON public.ad_os_search_terms
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.tenant_ad_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  workspace_name text NOT NULL DEFAULT 'Default Ad Workspace',
  owner_user_id uuid NULL,
  allowed_platforms text[] NOT NULL DEFAULT ARRAY['naver', 'google']::text[]
    CHECK (allowed_platforms <@ ARRAY['naver', 'google', 'meta', 'kakao']::text[]),
  monthly_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_cap_krw >= 0),
  daily_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_budget_cap_krw >= 0),
  max_cpc_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_krw >= 0),
  max_test_loss_krw integer NOT NULL DEFAULT 0 CHECK (max_test_loss_krw >= 0),
  automation_level integer NOT NULL DEFAULT 2 CHECK (automation_level >= 0 AND automation_level <= 5),
  require_human_approval boolean NOT NULL DEFAULT true,
  full_auto_enabled boolean NOT NULL DEFAULT false,
  risk_status text NOT NULL DEFAULT 'watch' CHECK (risk_status IN ('normal', 'watch', 'restricted', 'blocked')),
  sensitive_keywords text[] NOT NULL DEFAULT '{}'::text[],
  forbidden_phrases text[] NOT NULL DEFAULT '{}'::text[],
  report_recipients text[] NOT NULL DEFAULT '{}'::text[],
  billing_plan text NOT NULL DEFAULT 'internal' CHECK (billing_plan IN ('internal', 'pilot', 'agency', 'enterprise')),
  last_monthly_report_at timestamptz NULL,
  created_by uuid NULL,
  applied_by uuid NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_ad_workspaces_global
  ON public.tenant_ad_workspaces((tenant_id IS NULL))
  WHERE tenant_id IS NULL;

ALTER TABLE public.tenant_ad_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_ad_workspaces_service" ON public.tenant_ad_workspaces;
CREATE POLICY "tenant_ad_workspaces_service"
  ON public.tenant_ad_workspaces
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
