-- Minimal production-shaped schema used to compile and behavior-test the
-- Clobe mixed-outflow migration in a disposable PostgreSQL container.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  lead_customer_id UUID,
  booking_no TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  settlement_confirmed_at TIMESTAMPTZ,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  total_paid_out INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT '미입금',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.bank_transactions (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  source TEXT NOT NULL,
  external_provider TEXT,
  transaction_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  match_status TEXT DEFAULT 'unmatched',
  status TEXT NOT NULL DEFAULT 'active',
  counterparty_name TEXT,
  booking_id UUID REFERENCES public.bookings(id),
  match_confidence NUMERIC,
  matched_by TEXT,
  matched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_fee BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.bank_transaction_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id),
  booking_id UUID REFERENCES public.bookings(id),
  ledger_account TEXT,
  allocated_amount INTEGER NOT NULL CHECK (allocated_amount > 0),
  ledger_delta INTEGER,
  allocation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reversed_at TIMESTAMPTZ,
  reason TEXT
);

CREATE TABLE public.ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id),
  paid_delta INTEGER NOT NULL,
  payout_delta INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_ref_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  booking_id UUID,
  customer_id UUID,
  bank_transaction_id UUID,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_value JSONB,
  after_value JSONB,
  description TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_booking_ledger(
  p_booking_id UUID,
  p_paid_delta INTEGER,
  p_payout_delta INTEGER,
  p_source TEXT,
  p_source_ref_id TEXT,
  p_idempotency_key TEXT,
  p_memo TEXT,
  p_created_by TEXT
) RETURNS TABLE(
  paid_amount INTEGER,
  total_paid_out INTEGER,
  payment_status TEXT,
  booking_status TEXT,
  auto_status_changed BOOLEAN
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ledger_entries le
    WHERE le.idempotency_key = p_idempotency_key
  ) THEN
    RETURN QUERY
    SELECT b.paid_amount, b.total_paid_out, b.payment_status, b.status, FALSE
    FROM public.bookings b WHERE b.id = p_booking_id;
    RETURN;
  END IF;

  UPDATE public.bookings b
  SET paid_amount = b.paid_amount + p_paid_delta,
      total_paid_out = b.total_paid_out + p_payout_delta
  WHERE b.id = p_booking_id;

  INSERT INTO public.ledger_entries (
    booking_id, paid_delta, payout_delta, source, source_ref_id,
    idempotency_key, memo, created_by
  ) VALUES (
    p_booking_id, p_paid_delta, p_payout_delta, p_source, p_source_ref_id,
    p_idempotency_key, p_memo, p_created_by
  );

  RETURN QUERY
  SELECT b.paid_amount, b.total_paid_out, b.payment_status, b.status, FALSE
  FROM public.bookings b WHERE b.id = p_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_bank_transaction_allocations(
  p_transaction_id UUID,
  p_allocations JSONB,
  p_match_confidence NUMERIC DEFAULT 1,
  p_matched_by TEXT DEFAULT 'admin',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
AS $$ SELECT jsonb_build_object('ok', TRUE) $$;

GRANT EXECUTE ON FUNCTION public.update_booking_ledger(
  UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction_allocations(
  UUID, JSONB, NUMERIC, TEXT, TEXT
) TO anon, authenticated, service_role;
