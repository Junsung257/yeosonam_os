-- Ad OS V3-V7: channel visibility, normalized performance facts, blog evolution versions.
-- These tables are server-only operational data. External spend is still gated by
-- change requests, tenant policies, and explicit automation modes.

ALTER TABLE public.ad_os_product_scenarios
  DROP CONSTRAINT IF EXISTS ad_os_product_scenarios_scenario_type_check,
  ADD CONSTRAINT ad_os_product_scenarios_scenario_type_check
  CHECK (scenario_type IN (
    'regional_departure',
    'airline',
    'filial',
    'family',
    'comparison',
    'price_objection',
    'urgency',
    'safety',
    'activity',
    'seasonal',
    'differentiator',
    'retargeting'
  ));

CREATE TABLE IF NOT EXISTS public.blog_visibility_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  content_creative_id uuid NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  slug text NOT NULL,
  url text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('google', 'naver')),
  request_status text NOT NULL DEFAULT 'not_requested' CHECK (request_status IN (
    'not_requested',
    'requested',
    'request_failed',
    'unknown'
  )),
  index_status text NOT NULL DEFAULT 'unknown' CHECK (index_status IN (
    'unknown',
    'inspectable',
    'indexed',
    'not_indexed',
    'blocked',
    'verification_unavailable'
  )),
  visibility_status text NOT NULL DEFAULT 'unknown' CHECK (visibility_status IN (
    'unknown',
    'visible',
    'not_visible',
    'ranking_confirmed'
  )),
  best_rank numeric NULL,
  best_query text NULL,
  source text NOT NULL DEFAULT 'ad_os_visibility',
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  checked_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, slug, checked_at)
);

CREATE INDEX IF NOT EXISTS idx_blog_visibility_snapshots_slug_platform
  ON public.blog_visibility_snapshots(slug, platform, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_visibility_snapshots_status
  ON public.blog_visibility_snapshots(platform, index_status, visibility_status, checked_at DESC);

ALTER TABLE public.blog_visibility_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blog_visibility_snapshots_service" ON public.blog_visibility_snapshots;
CREATE POLICY "blog_visibility_snapshots_service"
  ON public.blog_visibility_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_performance_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  ad_landing_mapping_id uuid NULL REFERENCES public.ad_landing_mappings(id) ON DELETE SET NULL,
  content_creative_id uuid NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  ad_campaign_id uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  ad_creative_id uuid NULL REFERENCES public.ad_creatives(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  keyword_text text NULL,
  search_term text NULL,
  source text NOT NULL DEFAULT 'ad_os_performance_sync',
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost_krw integer NOT NULL DEFAULT 0 CHECK (cost_krw >= 0),
  cta_clicks integer NOT NULL DEFAULT 0 CHECK (cta_clicks >= 0),
  conversions numeric NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  revenue_krw integer NOT NULL DEFAULT 0 CHECK (revenue_krw >= 0),
  margin_krw integer NOT NULL DEFAULT 0,
  bounces integer NOT NULL DEFAULT 0 CHECK (bounces >= 0),
  sessions integer NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  avg_time_on_page_seconds numeric NOT NULL DEFAULT 0 CHECK (avg_time_on_page_seconds >= 0),
  avg_scroll_depth_pct numeric NOT NULL DEFAULT 0 CHECK (avg_scroll_depth_pct >= 0),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_performance_facts_product
  ON public.ad_os_performance_facts(product_id, event_date DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_performance_facts_mapping
  ON public.ad_os_performance_facts(ad_landing_mapping_id, event_date DESC)
  WHERE ad_landing_mapping_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_performance_facts_platform
  ON public.ad_os_performance_facts(platform, event_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_performance_facts_unique_source
  ON public.ad_os_performance_facts(
    source,
    event_date,
    platform,
    COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(keyword_text, ''),
    COALESCE(search_term, '')
  );

ALTER TABLE public.ad_os_performance_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_performance_facts_service" ON public.ad_os_performance_facts;
CREATE POLICY "ad_os_performance_facts_service"
  ON public.ad_os_performance_facts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.blog_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  content_creative_id uuid NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  slug text NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  change_type text NOT NULL CHECK (change_type IN (
    'initial',
    'cta_update',
    'seo_refresh',
    'ranking_recovery',
    'expired_product_replacement',
    'scenario_expansion'
  )),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN (
    'candidate',
    'approved',
    'applied',
    'rejected',
    'expired'
  )),
  title_before text NULL,
  title_after text NULL,
  body_hash_before text NULL,
  body_hash_after text NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version_no)
);

CREATE INDEX IF NOT EXISTS idx_blog_content_versions_slug
  ON public.blog_content_versions(slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_content_versions_status
  ON public.blog_content_versions(status, change_type, created_at DESC);

ALTER TABLE public.blog_content_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blog_content_versions_service" ON public.blog_content_versions;
CREATE POLICY "blog_content_versions_service"
  ON public.blog_content_versions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

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
    'external_publish'
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
    'create_card_news'
  ));
