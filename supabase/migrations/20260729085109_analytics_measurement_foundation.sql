-- Marketing measurement foundation.
-- Business events are server-written only. Platform delivery is isolated so
-- retries cannot duplicate the underlying conversion.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS attribution_snapshot jsonb NULL;

COMMENT ON COLUMN public.leads.attribution_snapshot IS
  'Allowlisted first/last-touch attribution and click IDs captured with consent; never contains lead PII.';

CREATE TABLE IF NOT EXISTS public.analytics_server_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN (
    'generate_lead',
    'purchase',
    'refund',
    'ysn_booking_confirmed'
  )),
  idempotency_key text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'lead',
    'booking',
    'checkout_transaction',
    'ledger'
  )),
  source_id text NOT NULL,
  lead_id uuid NULL,
  booking_id uuid NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  transaction_id text NULL,
  currency text NULL CHECK (currency IS NULL OR currency = 'KRW'),
  value_krw integer NULL CHECK (value_krw IS NULL OR value_krw >= 0),
  attribution_snapshot jsonb NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_server_events_source
  ON public.analytics_server_events(source_type, source_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_server_events_event_time
  ON public.analytics_server_events(event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_server_events_product_id
  ON public.analytics_server_events(product_id);

ALTER TABLE public.analytics_server_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "analytics_server_events_service" ON public.analytics_server_events;
CREATE POLICY "analytics_server_events_service"
  ON public.analytics_server_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.analytics_server_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analytics_server_events TO service_role;

CREATE TABLE IF NOT EXISTS public.analytics_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_event_id uuid NOT NULL REFERENCES public.analytics_server_events(id) ON DELETE CASCADE,
  destination text NOT NULL CHECK (destination IN (
    'ga4_measurement_protocol',
    'google_ads_data_manager'
  )),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned',
    'processing',
    'sent',
    'failed',
    'blocked'
  )),
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NULL,
  last_attempt_at timestamptz NULL,
  sent_at timestamptz NULL,
  last_error text NULL,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_delivery_jobs_ready
  ON public.analytics_delivery_jobs(destination, status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_analytics_delivery_jobs_server_event_id
  ON public.analytics_delivery_jobs(server_event_id);

ALTER TABLE public.analytics_delivery_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "analytics_delivery_jobs_service" ON public.analytics_delivery_jobs;
CREATE POLICY "analytics_delivery_jobs_service"
  ON public.analytics_delivery_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.analytics_delivery_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analytics_delivery_jobs TO service_role;
