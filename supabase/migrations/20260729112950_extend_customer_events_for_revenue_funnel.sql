-- P0 revenue rescue: extend the existing customer_events ledger instead of
-- creating a second conversion/event table.

ALTER TABLE public.customer_events
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consent_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE public.customer_events
  ALTER COLUMN occurred_at SET DEFAULT now();

ALTER TABLE public.customer_events
  DROP CONSTRAINT IF EXISTS customer_events_event_type_check,
  DROP CONSTRAINT IF EXISTS customer_events_consent_state_check;

ALTER TABLE public.customer_events
  ADD CONSTRAINT customer_events_event_type_check CHECK (event_type IN (
    'chat',
    'booking',
    'payment',
    'click',
    'support',
    'view',
    'search',
    'recommendation',
    'offer_viewed',
    'lead_started',
    'lead_submitted',
    'kakao_clicked',
    'operator_contacted',
    'quote_sent',
    'quote_accepted',
    'booking_created',
    'payment_received',
    'booking_confirmed',
    'booking_cancelled',
    'trip_completed',
    'review_requested',
    'review_submitted'
  )),
  ADD CONSTRAINT customer_events_consent_state_check CHECK (
    consent_state IN ('granted', 'denied', 'not_required', 'unknown')
  );

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS customer_events_source_dedupe_uidx
  ON public.customer_events(source, dedupe_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_events_offer_occurred_idx
  ON public.customer_events(offer_id, occurred_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_events_lead_occurred_idx
  ON public.customer_events(lead_id, occurred_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_events_booking_occurred_idx
  ON public.customer_events(booking_id, occurred_at DESC);

COMMENT ON COLUMN public.customer_events.source IS
  'Canonical acquisition source for revenue-funnel events; UTM details remain in payload.';
COMMENT ON COLUMN public.customer_events.dedupe_key IS
  'Caller-stable idempotency key, unique within source when non-null.';

-- The original tenant select policy treated tenant_id NULL as public data.
-- Revenue attribution rows are internal operational evidence, so direct reads
-- are restricted to database-backed admins. service_role continues to bypass RLS.
DROP POLICY IF EXISTS customer_events_tenant_select ON public.customer_events;
DROP POLICY IF EXISTS customer_events_admin_select ON public.customer_events;
CREATE POLICY customer_events_admin_select
  ON public.customer_events
  FOR SELECT
  TO authenticated
  USING ((SELECT public.yeosonam_is_admin_user()));
