-- Yeosonam OS - verified checkout completion contract
--
-- This migration is intentionally additive. It does not enable any payment
-- provider. It creates service-role-only evidence tables that allow checkout
-- completion only after a separate trusted path has verified payment.

CREATE TABLE IF NOT EXISTS public.checkout_payment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  provider_order_id text,
  amount_krw integer NOT NULL CHECK (amount_krw >= 0),
  currency text NOT NULL DEFAULT 'KRW' CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'verified'
    CHECK (status IN ('verified', 'voided', 'refunded')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_payment_confirmations_provider_payment_unique
    UNIQUE (provider, provider_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_payment_confirmations_tx_verified
  ON public.checkout_payment_confirmations (transaction_id, verified_at DESC)
  WHERE status = 'verified';

ALTER TABLE public.checkout_payment_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkout_payment_confirmations_service_role_all
  ON public.checkout_payment_confirmations;
CREATE POLICY checkout_payment_confirmations_service_role_all
  ON public.checkout_payment_confirmations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.checkout_payment_confirmations FROM anon, authenticated;
GRANT ALL ON public.checkout_payment_confirmations TO service_role;

COMMENT ON TABLE public.checkout_payment_confirmations IS
  'Trusted server-side payment evidence for checkout completion. The customer checkout complete API may reference these rows but may not create or modify them.';
COMMENT ON COLUMN public.checkout_payment_confirmations.raw_payload IS
  'Provider or bank evidence payload. Keep service-role-only because it may contain sensitive payment details.';

CREATE TABLE IF NOT EXISTS public.checkout_completion_claims (
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  payment_confirmation_id uuid NOT NULL REFERENCES public.checkout_payment_confirmations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  PRIMARY KEY (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_completion_claims_payment
  ON public.checkout_completion_claims (payment_confirmation_id);

CREATE INDEX IF NOT EXISTS idx_checkout_completion_claims_transaction
  ON public.checkout_completion_claims (transaction_id);

ALTER TABLE public.checkout_completion_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkout_completion_claims_service_role_all
  ON public.checkout_completion_claims;
CREATE POLICY checkout_completion_claims_service_role_all
  ON public.checkout_completion_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.checkout_completion_claims FROM anon, authenticated;
GRANT ALL ON public.checkout_completion_claims TO service_role;

COMMENT ON TABLE public.checkout_completion_claims IS
  'One-row-per-transaction claim used to prevent duplicate checkout completion and duplicate provider booking side effects.';
