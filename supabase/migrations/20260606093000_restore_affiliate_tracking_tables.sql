BEGIN;

CREATE TABLE IF NOT EXISTS public.affiliate_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  referral_code text NOT NULL,
  package_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  sub_id text NULL,
  ip_hash text NULL,
  user_agent_hash text NULL,
  is_bot boolean NOT NULL DEFAULT false,
  is_duplicate boolean NOT NULL DEFAULT false,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_touchpoints_ref_session
  ON public.affiliate_touchpoints(referral_code, session_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_touchpoints_ref_date
  ON public.affiliate_touchpoints(referral_code, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_touchpoints_package
  ON public.affiliate_touchpoints(package_id)
  WHERE package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_affiliate_touchpoints_ip_date
  ON public.affiliate_touchpoints(ip_hash, clicked_at DESC)
  WHERE is_bot = false;

CREATE TABLE IF NOT EXISTS public.influencer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_title text NULL,
  short_url text NOT NULL,
  click_count integer NOT NULL DEFAULT 0,
  conversion_count integer NOT NULL DEFAULT 0,
  unique_visitor_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, package_id, short_url)
);

CREATE INDEX IF NOT EXISTS idx_influencer_links_affiliate_created
  ON public.influencer_links(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_influencer_links_referral_package
  ON public.influencer_links(referral_code, package_id);
CREATE INDEX IF NOT EXISTS idx_influencer_links_affiliate_click_count
  ON public.influencer_links(affiliate_id, click_count DESC);

CREATE TABLE IF NOT EXISTS public.affiliate_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  max_uses integer NULL CHECK (max_uses IS NULL OR max_uses >= 0),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_promo_codes_affiliate
  ON public.affiliate_promo_codes(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_promo_codes_active
  ON public.affiliate_promo_codes(is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.affiliate_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  points integer NOT NULL DEFAULT 0,
  reward_amount integer NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_reward_events_affiliate
  ON public.affiliate_reward_events(affiliate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.affiliate_anomaly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NULL REFERENCES public.affiliates(id) ON DELETE SET NULL,
  referral_code text NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  session_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
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

CREATE TABLE IF NOT EXISTS public.affiliate_best_practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  channel text NOT NULL DEFAULT 'reels',
  summary text NOT NULL,
  example_url text NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_cs_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  script text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_code text NULL,
  ADD COLUMN IF NOT EXISTS promo_affiliate_id uuid NULL REFERENCES public.affiliates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_model text NOT NULL DEFAULT 'last_touch',
  ADD COLUMN IF NOT EXISTS attribution_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bookings_promo_code ON public.bookings(promo_code);
CREATE INDEX IF NOT EXISTS idx_bookings_promo_affiliate_id ON public.bookings(promo_affiliate_id);
CREATE INDEX IF NOT EXISTS idx_bookings_attribution_snapshot_gin ON public.bookings USING gin (attribution_snapshot);

CREATE OR REPLACE FUNCTION public.is_duplicate_click(
  p_session text,
  p_ref text,
  p_pkg uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.affiliate_touchpoints
    WHERE session_id = p_session
      AND referral_code = upper(btrim(p_ref))
      AND (package_id IS NOT DISTINCT FROM p_pkg)
      AND clicked_at > now() - interval '10 minutes'
  );
$$;

CREATE OR REPLACE FUNCTION public.increment_affiliate_promo_uses(
  p_promo_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uses integer;
BEGIN
  UPDATE public.affiliate_promo_codes
  SET
    uses_count = COALESCE(uses_count, 0) + 1,
    updated_at = now()
  WHERE code = upper(btrim(p_promo_code))
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
    AND (max_uses IS NULL OR COALESCE(uses_count, 0) < max_uses)
  RETURNING uses_count INTO v_uses;

  RETURN v_uses;
END;
$$;

ALTER TABLE public.affiliate_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_anomaly_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_best_practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_cs_scripts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_touchpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.influencer_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_promo_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_reward_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_anomaly_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_best_practices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_cs_scripts FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.affiliate_touchpoints TO service_role;
GRANT ALL ON TABLE public.influencer_links TO service_role;
GRANT ALL ON TABLE public.affiliate_promo_codes TO service_role;
GRANT ALL ON TABLE public.affiliate_reward_events TO service_role;
GRANT ALL ON TABLE public.affiliate_anomaly_events TO service_role;
GRANT ALL ON TABLE public.affiliate_best_practices TO service_role;
GRANT ALL ON TABLE public.affiliate_cs_scripts TO service_role;

DROP POLICY IF EXISTS affiliate_touchpoints_service_role_all ON public.affiliate_touchpoints;
CREATE POLICY affiliate_touchpoints_service_role_all ON public.affiliate_touchpoints
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS influencer_links_service_role_all ON public.influencer_links;
CREATE POLICY influencer_links_service_role_all ON public.influencer_links
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_promo_codes_service_role_all ON public.affiliate_promo_codes;
CREATE POLICY affiliate_promo_codes_service_role_all ON public.affiliate_promo_codes
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_reward_events_service_role_all ON public.affiliate_reward_events;
CREATE POLICY affiliate_reward_events_service_role_all ON public.affiliate_reward_events
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_anomaly_events_service_role_all ON public.affiliate_anomaly_events;
CREATE POLICY affiliate_anomaly_events_service_role_all ON public.affiliate_anomaly_events
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_best_practices_service_role_all ON public.affiliate_best_practices;
CREATE POLICY affiliate_best_practices_service_role_all ON public.affiliate_best_practices
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS affiliate_cs_scripts_service_role_all ON public.affiliate_cs_scripts;
CREATE POLICY affiliate_cs_scripts_service_role_all ON public.affiliate_cs_scripts
FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE EXECUTE ON FUNCTION public.is_duplicate_click(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_duplicate_click(text, text, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) TO service_role;

COMMENT ON TABLE public.affiliate_touchpoints IS
  'Affiliate click journey log for tracking, duplicate detection, and attribution analytics.';
COMMENT ON TABLE public.influencer_links IS
  'Partner-owned package referral links and aggregate click/conversion counters.';
COMMENT ON TABLE public.affiliate_promo_codes IS
  'Affiliate-owned promo codes used for attribution and limited discounts.';
COMMENT ON FUNCTION public.is_duplicate_click(text, text, uuid) IS
  'Returns true when the same affiliate session/ref/package clicked within the last 10 minutes.';
COMMENT ON FUNCTION public.increment_affiliate_promo_uses(text) IS
  'Atomically increments active affiliate promo-code use counts for server-side booking creation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
