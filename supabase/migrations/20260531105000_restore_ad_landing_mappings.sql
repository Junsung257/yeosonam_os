-- Restore the manually-created blog-to-ad landing mapping base table that the
-- tracked Ad OS migrations extend. Schema only: no mapping candidates or seed rows.

CREATE TABLE IF NOT EXISTS public.ad_landing_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_creative_id UUID NOT NULL
    REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  campaign_id UUID
    REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  platform TEXT NOT NULL
    CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  keyword TEXT NOT NULL,
  match_type TEXT,
  utm_source TEXT NOT NULL,
  utm_medium TEXT NOT NULL DEFAULT 'cpc',
  utm_campaign TEXT NOT NULL,
  utm_content TEXT,
  utm_term TEXT,
  dki_headline TEXT,
  dki_subtitle TEXT,
  landing_url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  conversions INTEGER NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, utm_campaign, utm_term, content_creative_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_landing_mappings_creative
  ON public.ad_landing_mappings(content_creative_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_landing_mappings_campaign
  ON public.ad_landing_mappings(campaign_id)
  WHERE campaign_id IS NOT NULL;
