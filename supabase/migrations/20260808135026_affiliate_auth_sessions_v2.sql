-- Affiliate authentication V2: one-time invitations, revocable server sessions,
-- and a durable encrypted notification outbox.
--
-- Safety contract:
--   * raw invitation tokens and OTPs are never stored in the database;
--   * browser roles have no direct table or RPC access;
--   * approval + affiliate + invitation + outbox creation is atomic;
--   * partner lifecycle or token_version changes revoke every live session;
--   * existing portal_pin values are NOT changed by this migration. Credential
--     rotation is an explicit, audited deployment step after the new flow ships.

BEGIN;

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS credentials_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS terminated_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliates_token_version_positive_chk'
      AND conrelid = 'public.affiliates'::regclass
  ) THEN
    ALTER TABLE public.affiliates
      ADD CONSTRAINT affiliates_token_version_positive_chk
      CHECK (token_version > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.affiliate_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.affiliate_applications(id) ON DELETE SET NULL,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'activation',
  token_hash text NOT NULL,
  recipient_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_sent_at timestamptz,
  otp_attempts integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_invitations_purpose_chk
    CHECK (purpose IN ('activation', 'credential_rotation')),
  CONSTRAINT affiliate_invitations_token_hash_chk
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT affiliate_invitations_recipient_hash_chk
    CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT affiliate_invitations_otp_attempts_chk
    CHECK (otp_attempts BETWEEN 0 AND 10),
  CONSTRAINT affiliate_invitations_lifecycle_chk
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_invitations_token_hash_uq
  ON public.affiliate_invitations(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_invitations_one_live_per_affiliate_uq
  ON public.affiliate_invitations(affiliate_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS affiliate_invitations_expiry_idx
  ON public.affiliate_invitations(expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS affiliate_invitations_application_idx
  ON public.affiliate_invitations(application_id)
  WHERE application_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.affiliate_sessions (
  id uuid PRIMARY KEY,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  jti uuid NOT NULL,
  token_version integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  ip_hash text,
  ua_hash text,
  CONSTRAINT affiliate_sessions_jti_uq UNIQUE (jti),
  CONSTRAINT affiliate_sessions_token_version_chk CHECK (token_version > 0),
  CONSTRAINT affiliate_sessions_expiry_chk CHECK (expires_at > issued_at),
  CONSTRAINT affiliate_sessions_ip_hash_chk
    CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT affiliate_sessions_ua_hash_chk
    CHECK (ua_hash IS NULL OR ua_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS affiliate_sessions_affiliate_live_idx
  ON public.affiliate_sessions(affiliate_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS affiliate_sessions_expiry_idx
  ON public.affiliate_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  destination_hash text NOT NULL,
  encrypted_payload text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_aggregate_type_chk
    CHECK (aggregate_type IN ('affiliate_invitation')),
  CONSTRAINT notification_outbox_event_type_chk
    CHECK (event_type IN ('affiliate_invitation_created')),
  CONSTRAINT notification_outbox_status_chk
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  CONSTRAINT notification_outbox_attempts_chk CHECK (attempts BETWEEN 0 AND 20),
  CONSTRAINT notification_outbox_destination_hash_chk
    CHECK (destination_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_event_aggregate_uq
  ON public.notification_outbox(event_type, aggregate_id);
CREATE INDEX IF NOT EXISTS notification_outbox_delivery_idx
  ON public.notification_outbox(available_at, created_at)
  WHERE status IN ('pending', 'failed');

COMMENT ON TABLE public.affiliate_invitations IS
  'Single-use affiliate activation/credential-rotation invitations. Only token and OTP hashes are stored.';
COMMENT ON TABLE public.affiliate_sessions IS
  'Revocable server-side affiliate sessions bound to JWT sid/jti/token_version claims.';
COMMENT ON TABLE public.notification_outbox IS
  'Encrypted server-only notification intents. Delivery failure never rolls back the business transaction.';

ALTER TABLE public.affiliate_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.affiliate_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.affiliate_invitations TO service_role;
GRANT ALL ON TABLE public.affiliate_sessions TO service_role;
GRANT ALL ON TABLE public.notification_outbox TO service_role;

DROP POLICY IF EXISTS affiliate_invitations_service_role_all ON public.affiliate_invitations;
CREATE POLICY affiliate_invitations_service_role_all
  ON public.affiliate_invitations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS affiliate_sessions_service_role_all ON public.affiliate_sessions;
CREATE POLICY affiliate_sessions_service_role_all
  ON public.affiliate_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS notification_outbox_service_role_all ON public.notification_outbox;
CREATE POLICY notification_outbox_service_role_all
  ON public.notification_outbox FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.revoke_affiliate_sessions_on_security_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.token_version IS DISTINCT FROM OLD.token_version
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.partner_status IS DISTINCT FROM OLD.partner_status THEN
    UPDATE public.affiliate_sessions
    SET revoked_at = COALESCE(revoked_at, now()),
        revoked_reason = COALESCE(
          revoked_reason,
          CASE
            WHEN NEW.is_active = false THEN 'affiliate_inactive'
            WHEN NEW.partner_status IN ('suspended', 'terminated') THEN 'partner_' || NEW.partner_status
            WHEN NEW.token_version IS DISTINCT FROM OLD.token_version THEN 'token_version_rotated'
            ELSE 'partner_status_changed'
          END
        )
    WHERE affiliate_id = NEW.id
      AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliates_revoke_sessions_security_change ON public.affiliates;
CREATE TRIGGER affiliates_revoke_sessions_security_change
AFTER UPDATE OF token_version, is_active, partner_status ON public.affiliates
FOR EACH ROW
EXECUTE FUNCTION public.revoke_affiliate_sessions_on_security_change();

CREATE OR REPLACE FUNCTION public.approve_affiliate_application_v2(
  p_application_id uuid,
  p_referral_code text,
  p_token_hash text,
  p_recipient_hash text,
  p_invitation_expires_at timestamptz,
  p_encrypted_payload text,
  p_created_by text,
  p_commission_rate numeric
)
RETURNS TABLE (
  affiliate_id uuid,
  affiliate_name text,
  affiliate_phone text,
  referral_code text,
  invitation_id uuid,
  outbox_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_application public.affiliate_applications%ROWTYPE;
  v_affiliate_id uuid;
  v_invitation_id uuid;
  v_outbox_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('affiliate-application:' || p_application_id::text, 0));

  SELECT * INTO v_application
  FROM public.affiliate_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'APPLICATION_NOT_FOUND';
  END IF;
  IF v_application.status <> 'PENDING' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'APPLICATION_ALREADY_REVIEWED';
  END IF;
  IF p_invitation_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INVITATION_EXPIRY';
  END IF;

  INSERT INTO public.affiliates (
    name, phone, referral_code, portal_pin, pin_hash,
    payout_type, business_number, commission_rate, is_active,
    partner_status, token_version, memo
  ) VALUES (
    v_application.name,
    v_application.phone,
    p_referral_code,
    NULL,
    NULL,
    CASE WHEN v_application.business_type = 'business' THEN 'BUSINESS' ELSE 'PERSONAL' END,
    v_application.business_number,
    p_commission_rate,
    true,
    'approved_not_onboarded',
    1,
    '채널: ' || v_application.channel_type || ' / ' || v_application.channel_url
      || CASE WHEN NULLIF(v_application.intro, '') IS NULL THEN '' ELSE ' / ' || v_application.intro END
  )
  RETURNING id INTO v_affiliate_id;

  UPDATE public.affiliate_applications
  SET status = 'APPROVED', reviewed_at = now()
  WHERE id = p_application_id;

  INSERT INTO public.affiliate_invitations (
    application_id, affiliate_id, purpose, token_hash, recipient_hash,
    expires_at, created_by
  ) VALUES (
    p_application_id, v_affiliate_id, 'activation', p_token_hash,
    p_recipient_hash, p_invitation_expires_at, p_created_by
  )
  RETURNING id INTO v_invitation_id;

  INSERT INTO public.notification_outbox (
    aggregate_type, aggregate_id, event_type, destination_hash,
    encrypted_payload, created_by
  ) VALUES (
    'affiliate_invitation', v_invitation_id, 'affiliate_invitation_created',
    p_recipient_hash, p_encrypted_payload, p_created_by
  )
  RETURNING id INTO v_outbox_id;

  RETURN QUERY SELECT
    v_affiliate_id,
    v_application.name,
    v_application.phone,
    p_referral_code,
    v_invitation_id,
    v_outbox_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_affiliate_invitation_v2(
  p_token_hash text,
  p_otp_hash text,
  p_session_id uuid,
  p_jti uuid,
  p_session_expires_at timestamptz,
  p_ip_hash text DEFAULT NULL,
  p_ua_hash text DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  affiliate_id uuid,
  affiliate_name text,
  referral_code text,
  token_version integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invitation public.affiliate_invitations%ROWTYPE;
  v_affiliate public.affiliates%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation
  FROM public.affiliate_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND OR v_invitation.revoked_at IS NOT NULL OR v_invitation.used_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_invitation', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_invitation.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired_invitation', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_invitation.otp_hash IS NULL OR v_invitation.otp_expires_at IS NULL THEN
    RETURN QUERY SELECT 'otp_required', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_invitation.otp_expires_at <= now() THEN
    RETURN QUERY SELECT 'otp_expired', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_invitation.otp_attempts >= 5 THEN
    UPDATE public.affiliate_invitations
    SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = 'otp_attempts_exhausted'
    WHERE id = v_invitation.id;
    RETURN QUERY SELECT 'otp_locked', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_invitation.otp_hash <> p_otp_hash THEN
    UPDATE public.affiliate_invitations
    SET otp_attempts = otp_attempts + 1
    WHERE id = v_invitation.id;
    RETURN QUERY SELECT 'otp_invalid', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_affiliate
  FROM public.affiliates
  WHERE id = v_invitation.affiliate_id
  FOR UPDATE;

  IF NOT FOUND OR v_affiliate.is_active = false
     OR v_affiliate.partner_status IN ('suspended', 'terminated') THEN
    UPDATE public.affiliate_invitations
    SET revoked_at = now(), revoked_reason = 'affiliate_restricted'
    WHERE id = v_invitation.id;
    RETURN QUERY SELECT 'affiliate_restricted', NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.affiliate_invitations
  SET used_at = now(), otp_hash = NULL, otp_expires_at = NULL
  WHERE id = v_invitation.id;

  UPDATE public.affiliates
  SET portal_pin = NULL,
      pin_hash = NULL,
      credentials_rotated_at = now(),
      portal_last_login_at = now(),
      portal_login_count = COALESCE(portal_login_count, 0) + 1,
      partner_status = CASE
        WHEN partner_status = 'approved_not_onboarded' THEN 'active'
        ELSE partner_status
      END,
      onboarded_at = COALESCE(onboarded_at, now())
  WHERE id = v_affiliate.id
  RETURNING * INTO v_affiliate;

  INSERT INTO public.affiliate_sessions (
    id, affiliate_id, jti, token_version, expires_at, ip_hash, ua_hash
  ) VALUES (
    p_session_id, v_affiliate.id, p_jti, v_affiliate.token_version,
    p_session_expires_at, p_ip_hash, p_ua_hash
  );

  RETURN QUERY SELECT
    'activated', v_affiliate.id, v_affiliate.name,
    v_affiliate.referral_code, v_affiliate.token_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_affiliate_credentials_v2(
  p_affiliate_id uuid,
  p_token_hash text,
  p_recipient_hash text,
  p_invitation_expires_at timestamptz,
  p_encrypted_payload text,
  p_created_by text
)
RETURNS TABLE (invitation_id uuid, outbox_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_affiliate public.affiliates%ROWTYPE;
  v_invitation_id uuid;
  v_outbox_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('affiliate-credential:' || p_affiliate_id::text, 0));
  SELECT * INTO v_affiliate
  FROM public.affiliates
  WHERE id = p_affiliate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AFFILIATE_NOT_FOUND';
  END IF;
  IF v_affiliate.phone IS NULL OR btrim(v_affiliate.phone) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AFFILIATE_PHONE_REQUIRED';
  END IF;
  IF p_invitation_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INVITATION_EXPIRY';
  END IF;

  UPDATE public.affiliate_invitations
  SET revoked_at = now(), revoked_reason = 'credential_rotation_reissued'
  WHERE affiliate_id = p_affiliate_id
    AND used_at IS NULL
    AND revoked_at IS NULL;

  UPDATE public.affiliates
  SET token_version = token_version + 1,
      portal_pin = NULL,
      pin_hash = NULL,
      credentials_rotated_at = now()
  WHERE id = p_affiliate_id;

  INSERT INTO public.affiliate_invitations (
    affiliate_id, purpose, token_hash, recipient_hash, expires_at, created_by
  ) VALUES (
    p_affiliate_id, 'credential_rotation', p_token_hash, p_recipient_hash,
    p_invitation_expires_at, p_created_by
  ) RETURNING id INTO v_invitation_id;

  INSERT INTO public.notification_outbox (
    aggregate_type, aggregate_id, event_type, destination_hash,
    encrypted_payload, created_by
  ) VALUES (
    'affiliate_invitation', v_invitation_id, 'affiliate_invitation_created',
    p_recipient_hash, p_encrypted_payload, p_created_by
  ) RETURNING id INTO v_outbox_id;

  RETURN QUERY SELECT v_invitation_id, v_outbox_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_affiliate_application_v2(
  uuid, text, text, text, timestamptz, text, text, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_affiliate_application_v2(
  uuid, text, text, text, timestamptz, text, text, numeric
) TO service_role;

REVOKE ALL ON FUNCTION public.activate_affiliate_invitation_v2(
  text, text, uuid, uuid, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_affiliate_invitation_v2(
  text, text, uuid, uuid, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.rotate_affiliate_credentials_v2(
  uuid, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_affiliate_credentials_v2(
  uuid, text, text, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_affiliate_sessions_on_security_change() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Manual rollback (only before any V2 invitation/session has been used):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.rotate_affiliate_credentials_v2(uuid,text,text,timestamptz,text,text);
-- DROP FUNCTION IF EXISTS public.activate_affiliate_invitation_v2(text,text,uuid,uuid,timestamptz,text,text);
-- DROP FUNCTION IF EXISTS public.approve_affiliate_application_v2(uuid,text,text,text,timestamptz,text,text,numeric);
-- DROP TRIGGER IF EXISTS affiliates_revoke_sessions_security_change ON public.affiliates;
-- DROP FUNCTION IF EXISTS public.revoke_affiliate_sessions_on_security_change();
-- DROP TABLE IF EXISTS public.notification_outbox;
-- DROP TABLE IF EXISTS public.affiliate_sessions;
-- DROP TABLE IF EXISTS public.affiliate_invitations;
-- ALTER TABLE public.affiliates DROP CONSTRAINT IF EXISTS affiliates_token_version_positive_chk;
-- ALTER TABLE public.affiliates
--   DROP COLUMN IF EXISTS terminated_reason,
--   DROP COLUMN IF EXISTS suspended_reason,
--   DROP COLUMN IF EXISTS credentials_rotated_at,
--   DROP COLUMN IF EXISTS token_version;
-- COMMIT;
