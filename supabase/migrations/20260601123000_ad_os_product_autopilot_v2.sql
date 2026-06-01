-- Ad OS product autopilot V2
-- Product approval now feeds scenario planning, blog evolution, and explainable
-- automation queues before any external ad spend is allowed.

CREATE TABLE IF NOT EXISTS public.ad_os_product_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  scenario_key text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN (
    'regional_departure',
    'filial',
    'family',
    'comparison',
    'price_objection',
    'urgency',
    'safety',
    'activity',
    'seasonal',
    'retargeting'
  )),
  funnel_stage text NOT NULL CHECK (funnel_stage IN ('awareness', 'consideration', 'conversion', 'retention')),
  target_segment text NOT NULL,
  primary_keyword text NOT NULL,
  keyword_variants text[] NOT NULL DEFAULT '{}'::text[],
  landing_strategy text NOT NULL CHECK (landing_strategy IN ('product_page', 'blog_new', 'blog_update', 'hub_page', 'card_news')),
  recommended_channel text NOT NULL CHECK (recommended_channel IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN (
    'candidate', 'queued', 'approved', 'testing', 'active', 'paused', 'won', 'lost', 'expired'
  )),
  priority integer NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  opportunity_score numeric NOT NULL DEFAULT 0 CHECK (opportunity_score >= 0),
  risk_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  learning_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, scenario_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_product_scenarios_status
  ON public.ad_os_product_scenarios(status, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_product_scenarios_package
  ON public.ad_os_product_scenarios(package_id, scenario_type);

CREATE INDEX IF NOT EXISTS idx_ad_os_product_scenarios_tenant
  ON public.ad_os_product_scenarios(tenant_id, status)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_product_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_product_scenarios_service" ON public.ad_os_product_scenarios;
CREATE POLICY "ad_os_product_scenarios_service"
  ON public.ad_os_product_scenarios
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_landing_evolution_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  package_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  content_creative_id uuid NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'create_blog',
    'update_blog',
    'replace_cta',
    'canonicalize',
    'noindex',
    'archive_expired',
    'create_card_news'
  )),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN (
    'candidate', 'approved', 'queued', 'applied', 'rejected', 'expired'
  )),
  priority integer NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_os_landing_evolution_queue_status
  ON public.ad_os_landing_evolution_queue(status, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_landing_evolution_queue_package
  ON public.ad_os_landing_evolution_queue(package_id, action)
  WHERE package_id IS NOT NULL;

ALTER TABLE public.ad_os_landing_evolution_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_landing_evolution_queue_service" ON public.ad_os_landing_evolution_queue;
CREATE POLICY "ad_os_landing_evolution_queue_service"
  ON public.ad_os_landing_evolution_queue
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.search_ad_keyword_plans
  ADD COLUMN IF NOT EXISTS scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intent_keywords text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS learning_applied_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_scenario
  ON public.search_ad_keyword_plans(scenario_id)
  WHERE scenario_id IS NOT NULL;

ALTER TABLE public.ad_landing_mappings
  ADD COLUMN IF NOT EXISTS scenario_id uuid NULL REFERENCES public.ad_os_product_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_group_key text NULL,
  ADD COLUMN IF NOT EXISTS canonical_role text NULL CHECK (canonical_role IS NULL OR canonical_role IN ('owner', 'variant', 'expired_variant')),
  ADD COLUMN IF NOT EXISTS replacement_mapping_id uuid NULL REFERENCES public.ad_landing_mappings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_landing_mappings_canonical_group
  ON public.ad_landing_mappings(canonical_group_key, canonical_role)
  WHERE canonical_group_key IS NOT NULL;
