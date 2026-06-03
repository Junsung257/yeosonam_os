-- Affiliate application/auth Phase 2 foundation.
-- Tracks consent/disclosure at application time, normalizes channel URLs,
-- separates partner lifecycle from boolean is_active, and prepares PIN hashing.

ALTER TABLE public.affiliate_applications
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS disclosure_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS channel_url_normalized text,
  ADD COLUMN IF NOT EXISTS application_risk_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS partner_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliates_partner_status_check'
  ) THEN
    ALTER TABLE public.affiliates
      ADD CONSTRAINT affiliates_partner_status_check
      CHECK (partner_status IN ('approved_not_onboarded', 'active', 'suspended', 'terminated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliates_partner_status
  ON public.affiliates(partner_status);

CREATE INDEX IF NOT EXISTS idx_affiliate_applications_risk
  ON public.affiliate_applications(application_risk_score DESC, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_identifier_attempted
  ON public.pin_attempts(identifier, attempted_at DESC);

ALTER TABLE IF EXISTS public.pin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pin_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pin_attempts TO service_role;

DROP POLICY IF EXISTS pin_attempts_service_role_all ON public.pin_attempts;
CREATE POLICY pin_attempts_service_role_all
ON public.pin_attempts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
