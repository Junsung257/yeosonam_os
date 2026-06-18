-- ============================================================================
-- Ad engagement context metadata
-- ============================================================================
-- Keep customer CTA click context queryable for marketing automation.
-- Examples: kakao_clicked source=destination_city_hero, destination=Da Nang.

ALTER TABLE public.ad_engagement_logs
  ADD COLUMN IF NOT EXISTS event_source TEXT,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ad_engagement_logs_event_source
  ON public.ad_engagement_logs(event_source, created_at DESC)
  WHERE event_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_engagement_logs_destination
  ON public.ad_engagement_logs(destination, created_at DESC)
  WHERE destination IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_engagement_logs_kakao_context
  ON public.ad_engagement_logs(event_type, event_source, created_at DESC)
  WHERE event_type = 'kakao_clicked';

COMMENT ON COLUMN public.ad_engagement_logs.event_source IS
  'Reader-facing surface/CTA source, e.g. destination_city_hero, blog_cta, chat_widget_escalation.';

COMMENT ON COLUMN public.ad_engagement_logs.destination IS
  'Destination context supplied by customer-facing CTA events for marketing automation.';

COMMENT ON COLUMN public.ad_engagement_logs.metadata IS
  'Non-PII event context such as CTA placement, intent, selected filters, and campaign surface.';
