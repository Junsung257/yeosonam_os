-- Ad OS V19-V25 enterprise layer.
-- Adds explicit keyword clusters, external mutation audit rows, and tenant
-- report snapshots. External spend is still gated by change requests.

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
    'external_asset_plan'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_keyword_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'naver' CHECK (platform IN ('naver', 'google')),
  cluster_key text NOT NULL,
  keyword_text text NOT NULL,
  match_type text NOT NULL DEFAULT 'exact' CHECK (match_type IN ('exact', 'phrase', 'broad')),
  tier text NOT NULL CHECK (tier IN ('core', 'mid', 'longtail', 'negative')),
  intent text NOT NULL DEFAULT 'conversion',
  source text NOT NULL DEFAULT 'ad_os_keyword_brain',
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'testing', 'active', 'negative', 'rejected', 'expired')),
  score numeric NOT NULL DEFAULT 0,
  suggested_bid_krw integer NOT NULL DEFAULT 0 CHECK (suggested_bid_krw >= 0),
  max_cpc_guard_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_guard_krw >= 0),
  landing_strategy text NOT NULL DEFAULT 'product_landing',
  negative_risk boolean NOT NULL DEFAULT false,
  duplicate_cluster boolean NOT NULL DEFAULT false,
  rationale text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, product_id, keyword_text, match_type)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_keyword_clusters_product
  ON public.ad_os_keyword_clusters(product_id, status, score DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_keyword_clusters_status
  ON public.ad_os_keyword_clusters(platform, status, tier, score DESC);

ALTER TABLE public.ad_os_keyword_clusters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_keyword_clusters_service" ON public.ad_os_keyword_clusters;
CREATE POLICY "ad_os_keyword_clusters_service"
  ON public.ad_os_keyword_clusters
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_external_mutation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  mutation_type text NOT NULL CHECK (mutation_type IN (
    'create_campaign',
    'create_business_channel',
    'create_ad_group',
    'create_paused_keyword',
    'activate_keyword',
    'pause_keyword',
    'update_bid',
    'sync_asset',
    'dry_run'
  )),
  mode text NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'change_request', 'paused_only', 'active_allowed')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'requested', 'succeeded', 'failed', 'blocked')),
  change_request_id uuid NULL REFERENCES public.ad_os_change_requests(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  external_account_id text NULL,
  external_campaign_id text NULL,
  external_ad_group_id text NULL,
  external_keyword_id text NULL,
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NULL,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_external_mutation_results_status
  ON public.ad_os_external_mutation_results(platform, status, created_at DESC);

ALTER TABLE public.ad_os_external_mutation_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_external_mutation_results_service" ON public.ad_os_external_mutation_results;
CREATE POLICY "ad_os_external_mutation_results_service"
  ON public.ad_os_external_mutation_results
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_tenant_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  report_type text NOT NULL DEFAULT 'monthly' CHECK (report_type IN ('weekly', 'monthly', 'pilot')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'archived')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NULL,
  applied_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_start, period_end, report_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_tenant_reports_global_period
  ON public.ad_os_tenant_reports((tenant_id IS NULL), period_start, period_end, report_type)
  WHERE tenant_id IS NULL;

ALTER TABLE public.ad_os_tenant_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_tenant_reports_service" ON public.ad_os_tenant_reports;
CREATE POLICY "ad_os_tenant_reports_service"
  ON public.ad_os_tenant_reports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
