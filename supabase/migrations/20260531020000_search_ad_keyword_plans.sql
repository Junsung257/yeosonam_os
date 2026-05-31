-- Search ad keyword plans generated from travel package inventory.
-- Draft-first by design: live publishing must be enabled separately.

CREATE TABLE IF NOT EXISTS public.search_ad_keyword_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('naver', 'google')),
  plan_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (plan_status IN ('draft', 'approved', 'published', 'failed', 'archived')),

  campaign_name TEXT NOT NULL,
  campaign_slug TEXT NOT NULL,
  ad_group_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('core', 'mid', 'longtail', 'negative')),
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'phrase', 'broad')),
  keyword_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'package_auto_planner',

  suggested_bid_krw INTEGER NOT NULL DEFAULT 0,
  daily_budget_share_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  monthly_search_volume INTEGER,
  competition_level TEXT CHECK (competition_level IN ('low', 'medium', 'high')),

  landing_url TEXT NOT NULL,
  utm_url TEXT NOT NULL,
  rationale TEXT,
  quality_flags JSONB NOT NULL DEFAULT '{}'::jsonb,

  external_campaign_id TEXT,
  external_ad_group_id TEXT,
  external_keyword_id TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (package_id, platform, keyword_text, match_type)
);

CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_package
  ON public.search_ad_keyword_plans(package_id, platform, plan_status);

CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_external_keyword
  ON public.search_ad_keyword_plans(platform, external_keyword_id)
  WHERE external_keyword_id IS NOT NULL;

ALTER TABLE public.search_ad_keyword_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_search_ad_keyword_plans_all" ON public.search_ad_keyword_plans;
CREATE POLICY "service_search_ad_keyword_plans_all"
  ON public.search_ad_keyword_plans FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_search_ad_keyword_plans_read" ON public.search_ad_keyword_plans;
CREATE POLICY "auth_search_ad_keyword_plans_read"
  ON public.search_ad_keyword_plans FOR SELECT TO authenticated
  USING (true);
