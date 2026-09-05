-- Restore the manually-created affiliate content feedback table before the
-- tracked RLS-hardening migration. Schema only: no generated insight rows.

CREATE TABLE IF NOT EXISTS public.affiliate_content_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL
    REFERENCES public.affiliates(id) ON DELETE CASCADE,
  card_news_id UUID
    REFERENCES public.card_news(id) ON DELETE SET NULL,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_data JSONB,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_content_insights_feed
  ON public.affiliate_content_insights(affiliate_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_content_insights_card_news
  ON public.affiliate_content_insights(card_news_id)
  WHERE card_news_id IS NOT NULL;
