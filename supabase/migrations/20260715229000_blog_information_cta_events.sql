-- Minimal, anonymous, idempotent CTA telemetry for informational articles.
-- No session, user, href, UTM, free-form payload, IP, or user-agent is stored.

BEGIN;

CREATE TABLE IF NOT EXISTS public.blog_information_cta_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key_hash char(64) NOT NULL UNIQUE CHECK (event_key_hash ~ '^[0-9a-f]{64}$'),
  creative_id uuid NOT NULL REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  representative_key text NOT NULL REFERENCES public.blog_information_representatives(representative_key) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('impression', 'click')),
  cta_key text NOT NULL CHECK (cta_key IN (
    'NAVER_CAFE', 'DEAL_ROOM', 'CONSULTATION', 'RELATED_ARTICLES', 'OFFICIAL_SOURCE'
  )),
  placement text NOT NULL CHECK (placement IN ('mid', 'bottom')),
  destination_id text NOT NULL,
  intent text NOT NULL CHECK (intent IN (
    'food_budget', 'monthly_weather', 'airport_transport', 'hotel_areas',
    'family_budget', 'itinerary', 'shopping_souvenirs', 'currency_payment',
    'entry_requirements', 'travel_insurance'
  )),
  locale text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_information_cta_events_rollup
  ON public.blog_information_cta_events (creative_id, event_type, cta_key, received_at DESC);

ALTER TABLE public.blog_information_cta_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_information_cta_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.blog_information_cta_events TO service_role;

DROP POLICY IF EXISTS blog_information_cta_events_service_role
  ON public.blog_information_cta_events;
CREATE POLICY blog_information_cta_events_service_role
  ON public.blog_information_cta_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.record_blog_information_cta_event(
  p_event_key text,
  p_creative_id uuid,
  p_event_type text,
  p_cta_key text,
  p_placement text
)
RETURNS TABLE (accepted boolean, deduped boolean, rate_limited boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  v_representative public.blog_information_representatives%ROWTYPE;
  v_count integer;
  v_minute timestamptz := date_trunc('minute', now());
BEGIN
  IF p_event_type NOT IN ('impression', 'click')
    OR p_cta_key NOT IN ('NAVER_CAFE', 'DEAL_ROOM', 'CONSULTATION', 'RELATED_ARTICLES', 'OFFICIAL_SOURCE')
    OR p_placement NOT IN ('mid', 'bottom')
    OR p_event_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(impression|click):[A-Z_]+:(mid|bottom)$'
    OR split_part(p_event_key, ':', 2) <> p_event_type
    OR split_part(p_event_key, ':', 3) <> p_cta_key
    OR split_part(p_event_key, ':', 4) <> p_placement
    OR length(p_event_key) > 100 THEN
    RAISE EXCEPTION 'invalid informational CTA event';
  END IF;

  v_hash := encode(extensions.digest(p_event_key, 'sha256'), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash, 0));

  IF EXISTS (
    SELECT 1 FROM public.blog_information_cta_events AS event
    WHERE event.event_key_hash = v_hash
  ) THEN
    RETURN QUERY SELECT false, true, false;
    RETURN;
  END IF;

  SELECT representative.* INTO v_representative
  FROM public.public_blog_content_creatives AS creative
  JOIN public.blog_information_representatives AS representative
    ON representative.canonical_creative_id = creative.id
   AND representative.canonical_slug = creative.slug
   AND representative.status = 'active'
  WHERE creative.id = p_creative_id
    AND creative.product_id IS NULL
    AND creative.public_eligibility_lane = 'information_v2'
  FOR SHARE OF representative;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public informational representative not found';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat(p_creative_id::text, '|', p_event_type, '|', p_cta_key, '|', v_minute::text),
    0
  ));
  SELECT count(*) INTO v_count
  FROM public.blog_information_cta_events AS event
  WHERE event.creative_id = p_creative_id
    AND event.event_type = p_event_type
    AND event.cta_key = p_cta_key
    AND event.received_at >= v_minute;
  IF v_count >= 120 THEN
    RETURN QUERY SELECT false, false, true;
    RETURN;
  END IF;

  INSERT INTO public.blog_information_cta_events (
    event_key_hash, creative_id, representative_key, event_type, cta_key,
    placement, destination_id, intent, locale
  ) VALUES (
    v_hash, p_creative_id, v_representative.representative_key, p_event_type, p_cta_key,
    p_placement, v_representative.destination_id, v_representative.intent, v_representative.locale
  )
  ON CONFLICT (event_key_hash) DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, true, false;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, false, false;
END;
$$;

REVOKE ALL ON FUNCTION public.record_blog_information_cta_event(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_blog_information_cta_event(text, uuid, text, text, text)
  TO service_role;

COMMENT ON TABLE public.blog_information_cta_events IS
  'Anonymous aggregate-safe information CTA events. Fixed dimensions only; no persistent visitor identifier or arbitrary metadata.';

COMMIT;
