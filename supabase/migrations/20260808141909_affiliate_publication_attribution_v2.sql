-- Affiliate publication, attribution and discount contract V2.
-- This migration creates new records beside the legacy influencer_links and
-- affiliate_promo_codes tables. It deliberately does not auto-migrate or
-- activate legacy rows without an operator-reviewed validation pass.

BEGIN;

CREATE TABLE IF NOT EXISTS public.affiliate_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  channel_url text NOT NULL,
  display_name text NULL,
  verification_status text NOT NULL DEFAULT 'PENDING',
  verified_at timestamptz NULL,
  verified_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_channels_type_chk CHECK (
    channel_type IN ('BLOG', 'WEBSITE', 'INSTAGRAM', 'YOUTUBE', 'FACEBOOK', 'THREADS', 'KAKAO', 'OFFLINE', 'OTHER')
  ),
  CONSTRAINT affiliate_channels_verification_chk CHECK (
    verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED')
  ),
  CONSTRAINT affiliate_channels_url_chk CHECK (channel_url ~ '^https://')
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_channels_owner_url_uq
  ON public.affiliate_channels(affiliate_id, lower(channel_url));

CREATE TABLE IF NOT EXISTS public.affiliate_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  verification_method text NOT NULL DEFAULT 'DNS_TXT',
  verification_token_hash text NOT NULL,
  verification_status text NOT NULL DEFAULT 'PENDING',
  verified_at timestamptz NULL,
  last_checked_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_domains_host_chk CHECK (
    hostname = lower(hostname)
    AND hostname !~ '[/:]'
    AND hostname ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT affiliate_domains_method_chk CHECK (verification_method IN ('DNS_TXT', 'HTML_FILE', 'META_TAG')),
  CONSTRAINT affiliate_domains_status_chk CHECK (
    verification_status IN ('PENDING', 'VERIFIED', 'FAILED', 'REVOKED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_domains_hostname_uq
  ON public.affiliate_domains(hostname);

CREATE TABLE IF NOT EXISTS public.creator_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  source text NOT NULL DEFAULT 'PARTNER',
  idempotency_key text NOT NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_codes_canonical_chk CHECK (
    code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
  ),
  CONSTRAINT creator_codes_status_chk CHECK (status IN ('ACTIVE', 'PAUSED', 'RETIRED')),
  CONSTRAINT creator_codes_source_chk CHECK (source IN ('PARTNER', 'ADMIN', 'LEGACY_VALIDATED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_codes_code_uq ON public.creator_codes(code);
CREATE UNIQUE INDEX IF NOT EXISTS creator_codes_idempotency_uq
  ON public.creator_codes(affiliate_id, idempotency_key);
CREATE INDEX IF NOT EXISTS creator_codes_affiliate_idx ON public.creator_codes(affiliate_id, created_at DESC);

COMMENT ON TABLE public.creator_codes IS
  'Attribution-only creator codes. These codes never change a customer price.';

CREATE TABLE IF NOT EXISTS public.discount_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  discount_type text NOT NULL,
  discount_value numeric(15,0) NOT NULL,
  eligible_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  budget_krw bigint NOT NULL,
  reserved_budget_krw bigint NOT NULL DEFAULT 0,
  used_budget_krw bigint NOT NULL DEFAULT 0,
  margin_floor_krw bigint NOT NULL DEFAULT 0,
  max_redemptions integer NULL,
  cost_bearer text NOT NULL,
  stacking_policy text NOT NULL DEFAULT 'DENY',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NULL,
  paused_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discount_campaigns_code_chk CHECK (
    code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
  ),
  CONSTRAINT discount_campaigns_status_chk CHECK (
    status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED')
  ),
  CONSTRAINT discount_campaigns_type_chk CHECK (discount_type IN ('PERCENT', 'FIXED')),
  CONSTRAINT discount_campaigns_value_chk CHECK (
    (discount_type = 'PERCENT' AND discount_value BETWEEN 1 AND 100)
    OR (discount_type = 'FIXED' AND discount_value > 0)
  ),
  CONSTRAINT discount_campaigns_period_chk CHECK (starts_at < ends_at),
  CONSTRAINT discount_campaigns_budget_chk CHECK (
    budget_krw >= 0 AND reserved_budget_krw >= 0 AND used_budget_krw >= 0
    AND reserved_budget_krw + used_budget_krw <= budget_krw
  ),
  CONSTRAINT discount_campaigns_margin_chk CHECK (margin_floor_krw >= 0),
  CONSTRAINT discount_campaigns_redemptions_chk CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  CONSTRAINT discount_campaigns_bearer_chk CHECK (cost_bearer IN ('PLATFORM', 'LAND_OPERATOR', 'SHARED')),
  CONSTRAINT discount_campaigns_stacking_chk CHECK (stacking_policy IN ('DENY', 'ALLOW_EXPLICIT')),
  CONSTRAINT discount_campaigns_approval_chk CHECK (
    status NOT IN ('APPROVED', 'ACTIVE', 'PAUSED', 'EXPIRED')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS discount_campaigns_code_uq ON public.discount_campaigns(code);
CREATE INDEX IF NOT EXISTS discount_campaigns_active_idx
  ON public.discount_campaigns(starts_at, ends_at) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.affiliate_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE RESTRICT,
  collection_id uuid NULL,
  channel_id uuid NULL REFERENCES public.affiliate_channels(id) ON DELETE SET NULL,
  verified_domain_id uuid NULL REFERENCES public.affiliate_domains(id) ON DELETE SET NULL,
  legacy_link_id uuid NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
  channel_type text NOT NULL,
  placement_name text NOT NULL,
  sub_id text NULL,
  destination_url text NOT NULL,
  disclosure_version text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  published_url text NULL,
  idempotency_key text NOT NULL,
  click_count bigint NOT NULL DEFAULT 0,
  unique_visitor_count bigint NOT NULL DEFAULT 0,
  conversion_count bigint NOT NULL DEFAULT 0,
  first_published_at timestamptz NULL,
  last_checked_at timestamptz NULL,
  health_status text NOT NULL DEFAULT 'UNCHECKED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_publications_target_chk CHECK (num_nonnulls(product_id, collection_id) = 1),
  CONSTRAINT affiliate_publications_channel_chk CHECK (
    channel_type IN ('BLOG', 'WEBSITE', 'INSTAGRAM', 'YOUTUBE', 'FACEBOOK', 'THREADS', 'KAKAO', 'QR', 'OFFLINE', 'OTHER')
  ),
  CONSTRAINT affiliate_publications_placement_chk CHECK (
    char_length(btrim(placement_name)) BETWEEN 1 AND 80
  ),
  CONSTRAINT affiliate_publications_sub_chk CHECK (
    sub_id IS NULL OR sub_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  CONSTRAINT affiliate_publications_destination_chk CHECK (destination_url ~ '^https://'),
  CONSTRAINT affiliate_publications_published_url_chk CHECK (published_url IS NULL OR published_url ~ '^https://'),
  CONSTRAINT affiliate_publications_status_chk CHECK (
    status IN ('DRAFT', 'TESTED', 'PUBLISHED', 'PAUSED', 'BROKEN', 'RETIRED')
  ),
  CONSTRAINT affiliate_publications_health_chk CHECK (
    health_status IN ('UNCHECKED', 'HEALTHY', 'REDIRECTED', 'BROKEN', 'PRODUCT_UNAVAILABLE', 'DISCLOSURE_MISSING')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_publications_idempotency_uq
  ON public.affiliate_publications(affiliate_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_publications_legacy_link_uq
  ON public.affiliate_publications(legacy_link_id) WHERE legacy_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_publications_owner_idx
  ON public.affiliate_publications(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_publications_product_idx
  ON public.affiliate_publications(product_id, status) WHERE product_id IS NOT NULL;

COMMENT ON TABLE public.affiliate_publications IS
  'Canonical external placement. One ID joins a generated asset, click, booking attribution and settlement evidence.';

CREATE TABLE IF NOT EXISTS public.affiliate_publication_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  publication_id uuid NOT NULL REFERENCES public.affiliate_publications(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  command_type text NOT NULL,
  request_hash text NOT NULL,
  result_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_publication_commands_type_chk CHECK (
    command_type IN ('UPDATE_STATUS', 'REGISTER_PUBLISHED_URL')
  ),
  CONSTRAINT affiliate_publication_commands_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_publication_commands_idempotency_uq
  ON public.affiliate_publication_commands(affiliate_id, idempotency_key);

ALTER TABLE public.affiliate_touchpoints
  ADD COLUMN IF NOT EXISTS affiliate_id uuid NULL REFERENCES public.affiliates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publication_id uuid NULL REFERENCES public.affiliate_publications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_id uuid NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_id uuid NULL,
  ADD COLUMN IF NOT EXISTS consent_state text NOT NULL DEFAULT 'SESSION_ONLY',
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'affiliate-attribution-v2',
  ADD COLUMN IF NOT EXISTS event_id uuid NULL,
  ADD COLUMN IF NOT EXISTS landing_url text NULL,
  ADD COLUMN IF NOT EXISTS referer_domain text NULL,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'accepted';

ALTER TABLE public.affiliate_touchpoints
  DROP CONSTRAINT IF EXISTS affiliate_touchpoints_consent_state_chk,
  ADD CONSTRAINT affiliate_touchpoints_consent_state_chk CHECK (
    consent_state IN ('SESSION_ONLY', 'MARKETING_CONSENT', 'REVOKED')
  ) NOT VALID,
  DROP CONSTRAINT IF EXISTS affiliate_touchpoints_outcome_chk,
  ADD CONSTRAINT affiliate_touchpoints_outcome_chk CHECK (
    outcome IN ('accepted', 'filtered_bot', 'duplicate')
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_touchpoints_event_uq
  ON public.affiliate_touchpoints(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_touchpoints_publication_idx
  ON public.affiliate_touchpoints(publication_id, clicked_at DESC) WHERE publication_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_touchpoints_affiliate_idx
  ON public.affiliate_touchpoints(affiliate_id, clicked_at DESC) WHERE affiliate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attribution_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  winning_touchpoint_id uuid NULL REFERENCES public.affiliate_touchpoints(id) ON DELETE SET NULL,
  publication_id uuid NULL REFERENCES public.affiliate_publications(id) ON DELETE SET NULL,
  link_id uuid NULL REFERENCES public.influencer_links(id) ON DELETE SET NULL,
  creator_code_id uuid NULL REFERENCES public.creator_codes(id) ON DELETE SET NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  attribution_model text NOT NULL DEFAULT 'LAST_ELIGIBLE_TOUCH',
  reason_code text NOT NULL,
  policy_version text NOT NULL,
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  conversion_counted_at timestamptz NULL,
  CONSTRAINT attribution_decisions_model_chk CHECK (
    attribution_model IN ('LAST_ELIGIBLE_TOUCH', 'CREATOR_CODE', 'ADMIN_OVERRIDE', 'NONE')
  ),
  CONSTRAINT attribution_decisions_reason_chk CHECK (
    reason_code IN ('PUBLICATION_COOKIE', 'CREATOR_CODE', 'REFERRAL_COOKIE', 'ADMIN_OVERRIDE', 'NO_ELIGIBLE_TOUCH')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS attribution_decisions_booking_uq
  ON public.attribution_decisions(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attribution_decisions_affiliate_idx
  ON public.attribution_decisions(affiliate_id, decided_at DESC);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS attribution_decision_id uuid NULL REFERENCES public.attribution_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS creator_code_id uuid NULL REFERENCES public.creator_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_campaign_id uuid NULL REFERENCES public.discount_campaigns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS discount_amount_krw bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_eligible_price_krw bigint NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_discount_amount_v2_chk,
  ADD CONSTRAINT bookings_discount_amount_v2_chk CHECK (
    discount_amount_krw >= 0
    AND (discount_eligible_price_krw IS NULL OR discount_amount_krw <= discount_eligible_price_krw)
    AND (discount_campaign_id IS NOT NULL OR discount_amount_krw = 0)
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_attribution_decision_uq
  ON public.bookings(attribution_decision_id) WHERE attribution_decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.discount_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.discount_campaigns(id) ON DELETE RESTRICT,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'RESERVED',
  eligible_price_krw bigint NOT NULL,
  discount_amount_krw bigint NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL,
  released_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discount_redemptions_state_chk CHECK (state IN ('RESERVED', 'USED', 'RELEASED', 'REFUNDED')),
  CONSTRAINT discount_redemptions_amount_chk CHECK (
    eligible_price_krw >= 0 AND discount_amount_krw > 0 AND discount_amount_krw <= eligible_price_krw
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS discount_redemptions_idempotency_uq
  ON public.discount_redemptions(campaign_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS discount_redemptions_booking_uq
  ON public.discount_redemptions(booking_id) WHERE booking_id IS NOT NULL AND state IN ('RESERVED', 'USED');

CREATE OR REPLACE FUNCTION public.record_affiliate_touchpoint_v2(
  p_event_id uuid,
  p_session_id text,
  p_referral_code text DEFAULT NULL,
  p_publication_id uuid DEFAULT NULL,
  p_package_id uuid DEFAULT NULL,
  p_sub_id text DEFAULT NULL,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_is_bot boolean DEFAULT false,
  p_consent_state text DEFAULT 'SESSION_ONLY',
  p_landing_url text DEFAULT NULL,
  p_referer_domain text DEFAULT NULL
)
RETURNS TABLE(touchpoint_id uuid, affiliate_id uuid, publication_id uuid, link_id uuid, referral_code text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate public.affiliates%ROWTYPE;
  v_publication public.affiliate_publications%ROWTYPE;
  v_link_id uuid;
  v_ref text;
  v_package_id uuid;
  v_duplicate boolean := false;
  v_first_visit boolean := false;
  v_touchpoint_id uuid;
  v_outcome text;
BEGIN
  IF p_event_id IS NULL OR p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'INVALID_TRACKING_EVENT';
  END IF;

  SELECT t.id, t.affiliate_id, t.publication_id, t.link_id, t.referral_code, t.outcome
    INTO touchpoint_id, affiliate_id, publication_id, link_id, referral_code, outcome
  FROM public.affiliate_touchpoints t
  WHERE t.event_id = p_event_id;
  IF FOUND THEN RETURN NEXT; RETURN; END IF;

  IF p_publication_id IS NOT NULL THEN
    SELECT * INTO v_publication
    FROM public.affiliate_publications p
    WHERE p.id = p_publication_id
      AND p.status IN ('DRAFT', 'TESTED', 'PUBLISHED')
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PUBLICATION'; END IF;
    SELECT * INTO v_affiliate FROM public.affiliates a WHERE a.id = v_publication.affiliate_id;
    v_ref := v_affiliate.referral_code;
    v_package_id := v_publication.product_id;
    v_link_id := v_publication.legacy_link_id;
  ELSE
    v_ref := upper(btrim(COALESCE(p_referral_code, '')));
    SELECT * INTO v_affiliate FROM public.affiliates a WHERE a.referral_code = v_ref;
    v_package_id := p_package_id;
    SELECT l.id INTO v_link_id
    FROM public.influencer_links l
    WHERE l.affiliate_id = v_affiliate.id AND l.package_id IS NOT DISTINCT FROM v_package_id
    ORDER BY l.created_at DESC LIMIT 1;
  END IF;

  IF v_affiliate.id IS NULL
     OR v_affiliate.is_active IS DISTINCT FROM true
     OR COALESCE(v_affiliate.partner_status, 'active') IN ('suspended', 'terminated') THEN
    RAISE EXCEPTION 'INVALID_PARTNER';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.affiliate_touchpoints t
    WHERE t.session_id = p_session_id
      AND t.affiliate_id = v_affiliate.id
      AND t.publication_id IS NOT DISTINCT FROM p_publication_id
      AND t.package_id IS NOT DISTINCT FROM v_package_id
      AND t.clicked_at > now() - interval '10 minutes'
  ) INTO v_duplicate;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.affiliate_touchpoints t
    WHERE t.session_id = p_session_id
      AND t.affiliate_id = v_affiliate.id
      AND t.publication_id IS NOT DISTINCT FROM p_publication_id
      AND t.is_bot = false
  ) INTO v_first_visit;

  v_outcome := CASE WHEN p_is_bot THEN 'filtered_bot' WHEN v_duplicate THEN 'duplicate' ELSE 'accepted' END;

  INSERT INTO public.affiliate_touchpoints (
    event_id, session_id, referral_code, affiliate_id, publication_id, link_id,
    package_id, sub_id, ip_hash, user_agent_hash, is_bot, is_duplicate,
    consent_state, policy_version, landing_url, referer_domain, outcome
  ) VALUES (
    p_event_id, p_session_id, v_ref, v_affiliate.id, p_publication_id, v_link_id,
    v_package_id, NULLIF(btrim(p_sub_id), ''), p_ip_hash, p_user_agent_hash,
    p_is_bot, v_duplicate, p_consent_state, 'affiliate-attribution-v2',
    p_landing_url, p_referer_domain, v_outcome
  ) RETURNING id INTO v_touchpoint_id;

  IF v_outcome = 'accepted' THEN
    IF p_publication_id IS NOT NULL THEN
      UPDATE public.affiliate_publications
      SET click_count = click_count + 1,
          unique_visitor_count = unique_visitor_count + CASE WHEN v_first_visit THEN 1 ELSE 0 END,
          updated_at = now()
      WHERE id = p_publication_id;
    END IF;
    IF v_link_id IS NOT NULL THEN
      UPDATE public.influencer_links
      SET click_count = click_count + 1,
          unique_visitor_count = unique_visitor_count + CASE WHEN v_first_visit THEN 1 ELSE 0 END,
          updated_at = now()
      WHERE id = v_link_id;
    END IF;
  END IF;

  touchpoint_id := v_touchpoint_id;
  affiliate_id := v_affiliate.id;
  publication_id := p_publication_id;
  link_id := v_link_id;
  referral_code := v_ref;
  outcome := v_outcome;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_affiliate_attribution_v2(
  p_decision_id uuid,
  p_booking_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision public.attribution_decisions%ROWTYPE;
BEGIN
  SELECT * INTO v_decision
  FROM public.attribution_decisions
  WHERE id = p_decision_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTRIBUTION_DECISION_NOT_FOUND'; END IF;
  IF v_decision.booking_id IS NOT NULL AND v_decision.booking_id <> p_booking_id THEN
    RAISE EXCEPTION 'ATTRIBUTION_DECISION_ALREADY_BOUND';
  END IF;

  UPDATE public.attribution_decisions
  SET booking_id = p_booking_id,
      conversion_counted_at = COALESCE(conversion_counted_at, now())
  WHERE id = p_decision_id;

  UPDATE public.bookings
  SET attribution_decision_id = p_decision_id
  WHERE id = p_booking_id
    AND (attribution_decision_id IS NULL OR attribution_decision_id = p_decision_id);

  IF v_decision.conversion_counted_at IS NULL THEN
    IF v_decision.publication_id IS NOT NULL THEN
      UPDATE public.affiliate_publications
      SET conversion_count = conversion_count + 1, updated_at = now()
      WHERE id = v_decision.publication_id;
    END IF;
    IF v_decision.link_id IS NOT NULL THEN
      UPDATE public.influencer_links
      SET conversion_count = conversion_count + 1, updated_at = now()
      WHERE id = v_decision.link_id;
    END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_affiliate_attribution_on_booking_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.attribution_decision_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.attribution_decision_id IS DISTINCT FROM NEW.attribution_decision_id) THEN
    PERFORM public.finalize_affiliate_attribution_v2(NEW.attribution_decision_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_finalize_affiliate_attribution_v2 ON public.bookings;
CREATE TRIGGER bookings_finalize_affiliate_attribution_v2
AFTER INSERT OR UPDATE OF attribution_decision_id ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.finalize_affiliate_attribution_on_booking_v2();

CREATE OR REPLACE FUNCTION public.reserve_discount_redemption_v2(
  p_campaign_id uuid,
  p_idempotency_key text,
  p_product_id uuid,
  p_eligible_price_krw bigint
)
RETURNS public.discount_redemptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.discount_campaigns%ROWTYPE;
  v_existing public.discount_redemptions%ROWTYPE;
  v_redemption public.discount_redemptions%ROWTYPE;
  v_amount bigint;
  v_redemption_count bigint;
BEGIN
  SELECT * INTO v_existing FROM public.discount_redemptions
  WHERE campaign_id = p_campaign_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_campaign FROM public.discount_campaigns
  WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR v_campaign.status <> 'ACTIVE' OR now() NOT BETWEEN v_campaign.starts_at AND v_campaign.ends_at THEN
    RAISE EXCEPTION 'DISCOUNT_CAMPAIGN_NOT_ACTIVE';
  END IF;
  IF cardinality(v_campaign.eligible_product_ids) > 0
     AND NOT (p_product_id = ANY(v_campaign.eligible_product_ids)) THEN
    RAISE EXCEPTION 'DISCOUNT_PRODUCT_NOT_ELIGIBLE';
  END IF;
  IF p_eligible_price_krw <= 0 THEN RAISE EXCEPTION 'INVALID_ELIGIBLE_PRICE'; END IF;

  v_amount := CASE
    WHEN v_campaign.discount_type = 'PERCENT'
      THEN floor(p_eligible_price_krw * v_campaign.discount_value / 100.0)::bigint
    ELSE v_campaign.discount_value::bigint
  END;
  IF v_amount <= 0 OR v_amount > p_eligible_price_krw THEN RAISE EXCEPTION 'INVALID_DISCOUNT_AMOUNT'; END IF;
  IF p_eligible_price_krw - v_amount < v_campaign.margin_floor_krw THEN RAISE EXCEPTION 'DISCOUNT_MARGIN_FLOOR'; END IF;
  IF v_campaign.reserved_budget_krw + v_campaign.used_budget_krw + v_amount > v_campaign.budget_krw THEN
    RAISE EXCEPTION 'DISCOUNT_BUDGET_EXHAUSTED';
  END IF;
  IF v_campaign.max_redemptions IS NOT NULL THEN
    SELECT count(*) INTO v_redemption_count FROM public.discount_redemptions
    WHERE campaign_id = p_campaign_id AND state IN ('RESERVED', 'USED');
    IF v_redemption_count >= v_campaign.max_redemptions THEN RAISE EXCEPTION 'DISCOUNT_MAX_REDEMPTIONS'; END IF;
  END IF;

  INSERT INTO public.discount_redemptions (
    campaign_id, idempotency_key, eligible_price_krw, discount_amount_krw
  ) VALUES (
    p_campaign_id, p_idempotency_key, p_eligible_price_krw, v_amount
  ) RETURNING * INTO v_redemption;

  UPDATE public.discount_campaigns
  SET reserved_budget_krw = reserved_budget_krw + v_amount, updated_at = now()
  WHERE id = p_campaign_id;
  RETURN v_redemption;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_affiliate_publication_v2(
  p_affiliate_id uuid,
  p_publication_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_status text,
  p_published_url text DEFAULT NULL
)
RETURNS public.affiliate_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_publication public.affiliate_publications%ROWTYPE;
  v_command public.affiliate_publication_commands%ROWTYPE;
  v_command_type text;
BEGIN
  SELECT * INTO v_command
  FROM public.affiliate_publication_commands
  WHERE affiliate_id = p_affiliate_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_command.request_hash <> p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO v_publication FROM public.affiliate_publications WHERE id = v_command.publication_id;
    RETURN v_publication;
  END IF;

  SELECT * INTO v_publication
  FROM public.affiliate_publications
  WHERE id = p_publication_id AND affiliate_id = p_affiliate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_NOT_FOUND'; END IF;
  IF p_status NOT IN ('DRAFT', 'TESTED', 'PUBLISHED', 'PAUSED', 'RETIRED') THEN
    RAISE EXCEPTION 'PUBLICATION_STATUS_NOT_ALLOWED';
  END IF;
  IF NOT (
    v_publication.status = p_status
    OR (v_publication.status = 'DRAFT' AND p_status IN ('TESTED', 'RETIRED'))
    OR (v_publication.status = 'TESTED' AND p_status IN ('PUBLISHED', 'PAUSED', 'RETIRED'))
    OR (v_publication.status = 'PUBLISHED' AND p_status IN ('PAUSED', 'RETIRED'))
    OR (v_publication.status = 'PAUSED' AND p_status IN ('PUBLISHED', 'RETIRED'))
  ) THEN
    RAISE EXCEPTION 'INVALID_PUBLICATION_TRANSITION';
  END IF;
  IF p_status = 'PUBLISHED' AND COALESCE(NULLIF(btrim(p_published_url), ''), v_publication.published_url) IS NULL THEN
    RAISE EXCEPTION 'PUBLISHED_URL_REQUIRED';
  END IF;
  IF p_published_url IS NOT NULL AND p_published_url !~ '^https://' THEN
    RAISE EXCEPTION 'INVALID_PUBLISHED_URL';
  END IF;

  UPDATE public.affiliate_publications
  SET status = p_status,
      published_url = COALESCE(NULLIF(btrim(p_published_url), ''), published_url),
      first_published_at = CASE
        WHEN p_status = 'PUBLISHED' THEN COALESCE(first_published_at, now())
        ELSE first_published_at
      END,
      updated_at = now()
  WHERE id = p_publication_id
  RETURNING * INTO v_publication;

  v_command_type := CASE WHEN p_published_url IS NULL THEN 'UPDATE_STATUS' ELSE 'REGISTER_PUBLISHED_URL' END;
  INSERT INTO public.affiliate_publication_commands (
    affiliate_id, publication_id, idempotency_key, command_type, request_hash, result_snapshot
  ) VALUES (
    p_affiliate_id, p_publication_id, p_idempotency_key, v_command_type, p_request_hash, to_jsonb(v_publication)
  );
  RETURN v_publication;
END;
$$;

ALTER TABLE public.affiliate_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_publication_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribution_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_channels, public.affiliate_domains, public.creator_codes,
  public.discount_campaigns, public.affiliate_publications, public.affiliate_publication_commands, public.attribution_decisions,
  public.discount_redemptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.affiliate_channels, public.affiliate_domains, public.creator_codes,
  public.discount_campaigns, public.affiliate_publications, public.affiliate_publication_commands, public.attribution_decisions,
  public.discount_redemptions TO service_role;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'affiliate_channels', 'affiliate_domains', 'creator_codes', 'discount_campaigns',
    'affiliate_publications', 'affiliate_publication_commands', 'attribution_decisions', 'discount_redemptions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      v_table, v_table
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_affiliate_touchpoint_v2(uuid, text, text, uuid, uuid, text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_affiliate_attribution_v2(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_affiliate_attribution_on_booking_v2() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_discount_redemption_v2(uuid, text, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_affiliate_publication_v2(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_touchpoint_v2(uuid, text, text, uuid, uuid, text, text, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_affiliate_attribution_v2(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_affiliate_attribution_on_booking_v2() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_discount_redemption_v2(uuid, text, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_affiliate_publication_v2(uuid, uuid, text, text, text, text) TO service_role;

COMMENT ON TABLE public.discount_campaigns IS
  'Admin-approved customer price discounts with explicit budget, margin and eligibility constraints.';
COMMENT ON FUNCTION public.record_affiliate_touchpoint_v2(uuid, text, text, uuid, uuid, text, text, text, boolean, text, text, text) IS
  'Validates partner/publication state, records an idempotent touchpoint and atomically increments exact counters.';
COMMENT ON FUNCTION public.finalize_affiliate_attribution_v2(uuid, uuid) IS
  'Binds one attribution decision to one booking and idempotently increments the winning publication/link conversion.';
COMMENT ON FUNCTION public.reserve_discount_redemption_v2(uuid, text, uuid, bigint) IS
  'Reserves an approved discount under row lock with price, margin, budget, product and count validation.';
COMMENT ON FUNCTION public.update_affiliate_publication_v2(uuid, uuid, text, text, text, text) IS
  'Applies an allowed partner publication transition with idempotency and optimistic evidence.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Reversible rollback (only before any V2 rows are used):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.reserve_discount_redemption_v2(uuid, text, uuid, bigint);
-- DROP FUNCTION IF EXISTS public.update_affiliate_publication_v2(uuid, uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.finalize_affiliate_attribution_v2(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.finalize_affiliate_attribution_on_booking_v2();
-- DROP FUNCTION IF EXISTS public.record_affiliate_touchpoint_v2(uuid, text, text, uuid, uuid, text, text, text, boolean, text, text, text);
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS discount_eligible_price_krw,
--   DROP COLUMN IF EXISTS discount_amount_krw, DROP COLUMN IF EXISTS discount_campaign_id,
--   DROP COLUMN IF EXISTS creator_code_id, DROP COLUMN IF EXISTS attribution_decision_id;
-- ALTER TABLE public.affiliate_touchpoints DROP COLUMN IF EXISTS outcome,
--   DROP COLUMN IF EXISTS referer_domain, DROP COLUMN IF EXISTS landing_url,
--   DROP COLUMN IF EXISTS event_id, DROP COLUMN IF EXISTS policy_version,
--   DROP COLUMN IF EXISTS consent_state, DROP COLUMN IF EXISTS content_id,
--   DROP COLUMN IF EXISTS link_id, DROP COLUMN IF EXISTS publication_id,
--   DROP COLUMN IF EXISTS affiliate_id;
-- DROP TABLE IF EXISTS public.discount_redemptions, public.attribution_decisions,
--   public.affiliate_publication_commands,
--   public.affiliate_publications, public.discount_campaigns, public.creator_codes,
--   public.affiliate_domains, public.affiliate_channels;
-- COMMIT;
