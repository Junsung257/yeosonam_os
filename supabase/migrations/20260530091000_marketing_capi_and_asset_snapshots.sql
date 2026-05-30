-- Marketing CAPI + Asset Group Snapshots
-- Adds durable logs for Meta Conversions API and daily product marketing state.

CREATE TABLE IF NOT EXISTS public.meta_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  action_source TEXT NOT NULL DEFAULT 'website',
  event_source_url TEXT,
  product_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  session_id TEXT,
  fbp TEXT,
  fbc TEXT,
  value NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'KRW',
  consent_granted BOOLEAN NOT NULL DEFAULT false,
  sent_to_meta BOOLEAN NOT NULL DEFAULT false,
  meta_status INTEGER,
  meta_response JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_created_at
  ON public.meta_conversion_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_product
  ON public.meta_conversion_events(product_id);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_booking
  ON public.meta_conversion_events(booking_id);

ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_conversion_events_service_all ON public.meta_conversion_events;

CREATE POLICY meta_conversion_events_service_all
  ON public.meta_conversion_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.marketing_asset_group_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  captured_date DATE NOT NULL DEFAULT CURRENT_DATE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  readiness_score INTEGER NOT NULL CHECK (readiness_score BETWEEN 0 AND 100),
  blog_total INTEGER NOT NULL DEFAULT 0,
  blog_published INTEGER NOT NULL DEFAULT 0,
  latest_blog_slug TEXT,
  gsc_impressions INTEGER NOT NULL DEFAULT 0,
  gsc_clicks INTEGER NOT NULL DEFAULT 0,
  gsc_position NUMERIC(10, 3),
  gsc_health_score INTEGER NOT NULL DEFAULT 0 CHECK (gsc_health_score BETWEEN 0 AND 100),
  card_news_total INTEGER NOT NULL DEFAULT 0,
  card_news_confirmed INTEGER NOT NULL DEFAULT 0,
  social_published INTEGER NOT NULL DEFAULT 0,
  active_campaigns INTEGER NOT NULL DEFAULT 0,
  deployed_creatives INTEGER NOT NULL DEFAULT 0,
  total_spend_krw NUMERIC(14, 2) NOT NULL DEFAULT 0,
  distribution_failed INTEGER NOT NULL DEFAULT 0,
  actions_total INTEGER NOT NULL DEFAULT 0,
  critical_actions INTEGER NOT NULL DEFAULT 0,
  high_actions INTEGER NOT NULL DEFAULT 0,
  flags TEXT[] NOT NULL DEFAULT '{}',
  raw JSONB NOT NULL DEFAULT '{}',
  UNIQUE (product_id, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_marketing_asset_group_snapshots_date
  ON public.marketing_asset_group_snapshots(captured_date DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_asset_group_snapshots_product_date
  ON public.marketing_asset_group_snapshots(product_id, captured_date DESC);

ALTER TABLE public.marketing_asset_group_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_asset_group_snapshots_service_all ON public.marketing_asset_group_snapshots;

CREATE POLICY marketing_asset_group_snapshots_service_all
  ON public.marketing_asset_group_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.meta_conversion_events IS
  'Server-side Meta Conversions API event log with event_id dedupe and consent state.';

COMMENT ON TABLE public.marketing_asset_group_snapshots IS
  'Daily product-level marketing readiness, GSC, social, ads, and action snapshots.';
