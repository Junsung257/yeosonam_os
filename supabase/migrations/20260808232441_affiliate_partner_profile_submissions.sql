-- Partner-owned payout and tax submissions are encrypted at rest and never
-- returned as plaintext through the partner API. Review remains an admin
-- decision; submission alone never makes an account payout-ready.
BEGIN;

CREATE TABLE IF NOT EXISTS public.affiliate_payout_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  masked_account text NOT NULL,
  payout_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_REVIEW',
  idempotency_key text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by text NULL,
  review_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_payout_profiles_type_chk CHECK (payout_type IN ('PERSONAL', 'BUSINESS')),
  CONSTRAINT affiliate_payout_profiles_status_chk CHECK (
    status IN ('PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED')
  ),
  UNIQUE (affiliate_id),
  UNIQUE (affiliate_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.affiliate_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  masked_identifier text NOT NULL,
  tax_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_REVIEW',
  idempotency_key text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by text NULL,
  review_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_tax_profiles_type_chk CHECK (tax_type IN ('PERSONAL', 'BUSINESS')),
  CONSTRAINT affiliate_tax_profiles_status_chk CHECK (
    status IN ('PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED')
  ),
  UNIQUE (affiliate_id),
  UNIQUE (affiliate_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS affiliate_payout_profiles_review_idx
  ON public.affiliate_payout_profiles(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_tax_profiles_review_idx
  ON public.affiliate_tax_profiles(status, submitted_at DESC);

ALTER TABLE public.affiliate_payout_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_tax_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_payout_profiles, public.affiliate_tax_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.affiliate_payout_profiles, public.affiliate_tax_profiles TO service_role;

DROP POLICY IF EXISTS affiliate_payout_profiles_service_role_all ON public.affiliate_payout_profiles;
CREATE POLICY affiliate_payout_profiles_service_role_all
  ON public.affiliate_payout_profiles FOR ALL TO service_role
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS affiliate_tax_profiles_service_role_all ON public.affiliate_tax_profiles;
CREATE POLICY affiliate_tax_profiles_service_role_all
  ON public.affiliate_tax_profiles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.affiliate_payout_profiles IS
  'Encrypted partner payout submissions. Plaintext banking data must never be selected by an API route.';
COMMENT ON TABLE public.affiliate_tax_profiles IS
  'Encrypted partner tax submissions. Review status is separate from acceptance and payout execution.';

COMMIT;
