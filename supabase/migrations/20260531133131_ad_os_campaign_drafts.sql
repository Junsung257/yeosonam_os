-- Link Ad OS keyword plans to internal campaign/creative drafts.
-- External publishing still uses external_* ids after the platform API call succeeds.

ALTER TABLE public.search_ad_keyword_plans
  ADD COLUMN IF NOT EXISTS ad_campaign_id UUID REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ad_creative_id UUID REFERENCES public.ad_creatives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS draft_published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_ad_campaign
  ON public.search_ad_keyword_plans(ad_campaign_id)
  WHERE ad_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_ad_creative
  ON public.search_ad_keyword_plans(ad_creative_id)
  WHERE ad_creative_id IS NOT NULL;
