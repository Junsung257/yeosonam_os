-- Yeosonam OS - settlement memo keys
--
-- Operators paste bank rows manually and use a memo such as
-- 260715_<customer>_<land_operator> to identify one travel booking. Payer names can differ
-- by companion, so this key is stored separately from bank counterparty names.

CREATE TABLE IF NOT EXISTS public.booking_settlement_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  normalized_key TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  departure_date DATE NOT NULL,
  customer_name_snapshot TEXT NOT NULL,
  land_operator_id UUID REFERENCES public.land_operators(id) ON DELETE SET NULL,
  land_operator_name_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'review', 'retired')),
  source TEXT NOT NULL DEFAULT 'bank_memo_import',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_settlement_keys_active
  ON public.booking_settlement_keys (
    COALESCE(tenant_id::text, 'platform'),
    normalized_key
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_booking_settlement_keys_booking
  ON public.booking_settlement_keys (booking_id, status);

CREATE INDEX IF NOT EXISTS idx_booking_settlement_keys_land_operator
  ON public.booking_settlement_keys (land_operator_id)
  WHERE land_operator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_settlement_keys_lookup
  ON public.booking_settlement_keys (departure_date, customer_name_snapshot, land_operator_name_snapshot)
  WHERE status = 'active';

ALTER TABLE public.booking_settlement_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_settlement_keys_service_only" ON public.booking_settlement_keys;
CREATE POLICY "booking_settlement_keys_service_only"
  ON public.booking_settlement_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.booking_settlement_keys FROM anon, authenticated;
GRANT ALL ON public.booking_settlement_keys TO service_role;

COMMENT ON TABLE public.booking_settlement_keys IS
  'Manual bank-statement memo key to booking binding, e.g. 260715_<customer>_<land_operator>. Counterparty names are evidence only, not the matching key.';

COMMENT ON COLUMN public.booking_settlement_keys.normalized_key IS
  'Normalized memo key. One active key maps to one booking per tenant/platform.';
