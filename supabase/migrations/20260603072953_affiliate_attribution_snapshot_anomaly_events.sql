BEGIN;

ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS attribution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bookings_attribution_snapshot_gin
  ON public.bookings USING gin (attribution_snapshot);

CREATE TABLE IF NOT EXISTS public.affiliate_anomaly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NULL REFERENCES public.affiliates(id) ON DELETE SET NULL,
  referral_code text NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  session_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_anomaly_events_affiliate_detected
  ON public.affiliate_anomaly_events(affiliate_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_anomaly_events_status_detected
  ON public.affiliate_anomaly_events(status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_anomaly_events_booking
  ON public.affiliate_anomaly_events(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_anomaly_events_payload_gin
  ON public.affiliate_anomaly_events USING gin (payload);

ALTER TABLE IF EXISTS public.affiliate_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.affiliate_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_anomaly_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_touchpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_reward_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pin_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_anomaly_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.affiliate_touchpoints TO service_role;
GRANT ALL ON TABLE public.affiliate_reward_events TO service_role;
GRANT ALL ON TABLE public.settlements TO service_role;
GRANT ALL ON TABLE public.pin_attempts TO service_role;
GRANT ALL ON TABLE public.affiliate_anomaly_events TO service_role;

DROP POLICY IF EXISTS affiliate_touchpoints_service_role_all ON public.affiliate_touchpoints;
CREATE POLICY affiliate_touchpoints_service_role_all
ON public.affiliate_touchpoints
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_reward_events_service_role_all ON public.affiliate_reward_events;
CREATE POLICY affiliate_reward_events_service_role_all
ON public.affiliate_reward_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS settlements_service_role_all ON public.settlements;
CREATE POLICY settlements_service_role_all
ON public.settlements
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS pin_attempts_service_role_all ON public.pin_attempts;
CREATE POLICY pin_attempts_service_role_all
ON public.pin_attempts
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_anomaly_events_service_role_all ON public.affiliate_anomaly_events;
CREATE POLICY affiliate_anomaly_events_service_role_all
ON public.affiliate_anomaly_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
