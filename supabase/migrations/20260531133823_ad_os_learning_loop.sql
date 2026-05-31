-- Ad OS learning loop: normalize search terms, CTA/conversion winners, and next actions.

CREATE TABLE IF NOT EXISTS public.ad_os_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  platform TEXT NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao', 'organic')),
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'search_term_win',
    'search_term_negative',
    'landing_click',
    'cta_click',
    'conversion',
    'margin_win',
    'landing_underperform',
    'keyword_underperform'
  )),
  entity_table TEXT NULL,
  entity_id TEXT NULL,
  product_id UUID NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  ad_landing_mapping_id UUID NULL REFERENCES public.ad_landing_mappings(id) ON DELETE SET NULL,
  content_creative_id UUID NULL REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  keyword_text TEXT NULL,
  search_term TEXT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'applied', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ NULL,
  UNIQUE (source_table, source_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_learning_events_status
  ON public.ad_os_learning_events(status, signal_type, score DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_learning_events_product
  ON public.ad_os_learning_events(product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_learning_events_mapping
  ON public.ad_os_learning_events(ad_landing_mapping_id, created_at DESC)
  WHERE ad_landing_mapping_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_os_search_term_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL,
  platform TEXT NOT NULL CHECK (platform IN ('naver', 'google')),
  search_term TEXT NOT NULL,
  parent_keyword TEXT NULL,
  action TEXT NOT NULL CHECK (action IN ('add_keyword', 'add_negative', 'review')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  cost_krw INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  score NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ad_os_learning_loop',
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'applied', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, search_term, action)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_search_term_candidates_status
  ON public.ad_os_search_term_candidates(status, action, score DESC);

ALTER TABLE public.ad_os_learning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_learning_events_service" ON public.ad_os_learning_events;
CREATE POLICY "ad_os_learning_events_service"
  ON public.ad_os_learning_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ad_os_search_term_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_search_term_candidates_service" ON public.ad_os_search_term_candidates;
CREATE POLICY "ad_os_search_term_candidates_service"
  ON public.ad_os_search_term_candidates
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
