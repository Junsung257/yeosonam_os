-- Repair runtime settlement pieces required by Clobe bank sync.
-- Some production environments had the Clobe provider columns without the
-- allocation evidence tables/function, so this migration is intentionally
-- idempotent.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS transaction_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_bank_transactions_fingerprint
  ON public.bank_transactions (
    COALESCE(tenant_id::text, 'platform'),
    transaction_fingerprint
  )
  WHERE transaction_fingerprint IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_fingerprint_lookup
  ON public.bank_transactions (transaction_fingerprint)
  WHERE transaction_fingerprint IS NOT NULL;

COMMENT ON COLUMN public.bank_transactions.transaction_fingerprint IS
  'Stable same-transaction key across SMS, manual bank-statement imports, and Clobe sync.';

COMMENT ON COLUMN public.bank_transactions.source_metadata IS
  'Source-specific evidence retained without re-posting ledger entries.';

CREATE TABLE IF NOT EXISTS public.ops_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'booking_created',
    'booking_updated',
    'booking_cancelled',
    'payment_matched',
    'payment_unmatched',
    'payment_imported',
    'payment_excluded',
    'customer_updated',
    'customer_note',
    'mileage_adjusted',
    'ledger_drift',
    'settlement_created',
    'settlement_reversed'
  )),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  bank_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  ledger_entry_id UUID REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_events_created
  ON public.ops_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_booking_created
  ON public.ops_events(booking_id, created_at DESC)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_customer_created
  ON public.ops_events(customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_bank_tx_created
  ON public.ops_events(bank_transaction_id, created_at DESC)
  WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_ledger_entry_created
  ON public.ops_events(ledger_entry_id, created_at DESC)
  WHERE ledger_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_open_queue
  ON public.ops_events(status, severity, created_at DESC)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.bank_transaction_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  ledger_account TEXT NOT NULL CHECK (ledger_account IN ('paid_amount', 'total_paid_out')),
  allocated_amount BIGINT NOT NULL CHECK (allocated_amount > 0),
  ledger_delta BIGINT NOT NULL,
  allocation_type TEXT NOT NULL CHECK (allocation_type IN ('deposit', 'refund', 'payout')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_tx_alloc_active_booking
  ON public.bank_transaction_allocations(bank_transaction_id, booking_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bank_tx_alloc_booking
  ON public.bank_transaction_allocations(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_tx_alloc_tx
  ON public.bank_transaction_allocations(bank_transaction_id, created_at DESC);

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transaction_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_events_service_role_only ON public.ops_events;
CREATE POLICY ops_events_service_role_only ON public.ops_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS bank_transaction_allocations_service_role_only ON public.bank_transaction_allocations;
CREATE POLICY bank_transaction_allocations_service_role_only ON public.bank_transaction_allocations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.ops_events FROM anon, authenticated;
REVOKE ALL ON public.bank_transaction_allocations FROM anon, authenticated;
GRANT ALL ON public.ops_events TO service_role;
GRANT ALL ON public.bank_transaction_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.match_bank_transaction_allocations(
  p_transaction_id UUID,
  p_allocations JSONB,
  p_match_confidence NUMERIC DEFAULT 1,
  p_matched_by TEXT DEFAULT 'admin',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx RECORD;
  v_alloc RECORD;
  v_booking RECORD;
  v_total BIGINT := 0;
  v_diff BIGINT := 0;
  v_first_booking_id UUID := NULL;
  v_count INT := 0;
  v_ledger_account TEXT;
  v_ledger_delta BIGINT;
  v_allocation_type TEXT;
  v_idem TEXT;
  v_attempt INT;
BEGIN
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'allocations array is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, amount, transaction_type, is_refund, match_status, counterparty_name
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tx.match_status NOT IN ('unmatched', 'review', 'error') THEN
    RAISE EXCEPTION 'bank transaction already processed (match_status=%)', v_tx.match_status USING ERRCODE = 'P0001';
  END IF;

  FOR v_alloc IN
    SELECT
      (value->>'bookingId')::UUID AS booking_id,
      COALESCE((value->>'amount')::BIGINT, 0) AS amount,
      NULLIF(value->>'ledgerDelta', '')::BIGINT AS ledger_delta
    FROM jsonb_array_elements(p_allocations)
  LOOP
    IF v_alloc.booking_id IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION 'each allocation requires bookingId and positive amount' USING ERRCODE = 'P0001';
    END IF;
    IF v_alloc.ledger_delta IS NOT NULL AND (v_alloc.ledger_delta < 0 OR v_alloc.ledger_delta > v_alloc.amount) THEN
      RAISE EXCEPTION 'ledgerDelta must be between 0 and allocation amount' USING ERRCODE = 'P0001';
    END IF;
    v_total := v_total + v_alloc.amount;
    v_count := v_count + 1;
    IF v_first_booking_id IS NULL THEN
      v_first_booking_id := v_alloc.booking_id;
    END IF;
  END LOOP;

  v_diff := v_total - COALESCE(v_tx.amount, 0);
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'allocated total exceeds transaction amount' USING ERRCODE = 'P0001';
  END IF;
  IF v_diff < -500 THEN
    RAISE EXCEPTION 'allocated total is lower than transaction amount' USING ERRCODE = 'P0001';
  END IF;

  FOR v_alloc IN
    SELECT
      (value->>'bookingId')::UUID AS booking_id,
      COALESCE((value->>'amount')::BIGINT, 0) AS amount,
      NULLIF(value->>'ledgerDelta', '')::BIGINT AS ledger_delta
    FROM jsonb_array_elements(p_allocations)
  LOOP
    SELECT id, lead_customer_id, booking_no
      INTO v_booking
    FROM public.bookings
    WHERE id = v_alloc.booking_id
      AND COALESCE(is_deleted, false) = false
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'booking not found or deleted: %', v_alloc.booking_id USING ERRCODE = 'P0002';
    END IF;

    IF v_tx.transaction_type = '입금' AND COALESCE(v_tx.is_refund, false) = false THEN
      v_ledger_account := 'paid_amount';
      v_ledger_delta := COALESCE(v_alloc.ledger_delta, v_alloc.amount);
      v_allocation_type := 'deposit';
    ELSIF COALESCE(v_tx.is_refund, false) = true THEN
      v_ledger_account := 'paid_amount';
      v_ledger_delta := -COALESCE(v_alloc.ledger_delta, v_alloc.amount);
      v_allocation_type := 'refund';
    ELSE
      v_ledger_account := 'total_paid_out';
      v_ledger_delta := COALESCE(v_alloc.ledger_delta, v_alloc.amount);
      v_allocation_type := 'payout';
    END IF;

    IF ABS(v_ledger_delta) > v_alloc.amount THEN
      RAISE EXCEPTION 'ledgerDelta cannot exceed allocated amount' USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) + 1
      INTO v_attempt
    FROM public.bank_transaction_allocations
    WHERE bank_transaction_id = p_transaction_id
      AND booking_id = v_alloc.booking_id;

    v_idem := 'bktxalloc:' || p_transaction_id::TEXT || ':' || v_alloc.booking_id::TEXT || ':' || v_attempt::TEXT;

    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id,
      booking_id,
      ledger_account,
      allocated_amount,
      ledger_delta,
      allocation_type,
      idempotency_key,
      notes,
      created_by
    ) VALUES (
      p_transaction_id,
      v_alloc.booking_id,
      v_ledger_account,
      v_alloc.amount,
      v_ledger_delta,
      v_allocation_type,
      v_idem,
      p_notes,
      p_matched_by
    );

    PERFORM public.update_booking_ledger(
      p_booking_id := v_alloc.booking_id,
      p_paid_delta := CASE WHEN v_ledger_account = 'paid_amount' THEN v_ledger_delta::INTEGER ELSE 0 END,
      p_payout_delta := CASE WHEN v_ledger_account = 'total_paid_out' THEN v_ledger_delta::INTEGER ELSE 0 END,
      p_source := 'bank_tx_manual_match',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := v_idem,
      p_memo := COALESCE(p_notes, 'bank transaction allocation match'),
      p_created_by := p_matched_by
    );

    INSERT INTO public.ops_events (
      event_type,
      severity,
      title,
      description,
      booking_id,
      customer_id,
      bank_transaction_id,
      target_type,
      target_id,
      status,
      metadata,
      created_by
    ) VALUES (
      'payment_matched',
      'info',
      CASE
        WHEN v_allocation_type = 'deposit' THEN '입금 매칭'
        WHEN v_allocation_type = 'refund' THEN '환불 매칭'
        ELSE '출금 매칭'
      END,
      format('%s %s allocated', COALESCE(v_tx.counterparty_name, 'transaction'), v_alloc.amount),
      v_alloc.booking_id,
      v_booking.lead_customer_id,
      p_transaction_id,
      'bank_transactions',
      p_transaction_id::TEXT,
      'resolved',
      jsonb_build_object(
        'allocation_type', v_allocation_type,
        'ledger_account', v_ledger_account,
        'ledger_delta', v_ledger_delta,
        'booking_no', v_booking.booking_no,
        'match_confidence', p_match_confidence
      ),
      p_matched_by
    );
  END LOOP;

  UPDATE public.bank_transactions
  SET booking_id = v_first_booking_id,
      match_status = 'manual',
      match_confidence = p_match_confidence,
      matched_by = p_matched_by,
      matched_at = now(),
      updated_at = now()
  WHERE id = p_transaction_id;

  INSERT INTO public.audit_logs (
    action,
    target_type,
    target_id,
    before_value,
    after_value,
    description,
    user_id
  ) VALUES (
    'bank_transaction_allocated',
    'bank_transactions',
    p_transaction_id::TEXT,
    jsonb_build_object('match_status', v_tx.match_status),
    jsonb_build_object(
      'match_status', 'manual',
      'allocation_count', v_count,
      'allocated_total', v_total,
      'representative_booking_id', v_first_booking_id,
      'actor', p_matched_by
    ),
    COALESCE(p_notes, 'bank transaction allocated to booking'),
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'representative_booking_id', v_first_booking_id,
    'allocation_count', v_count,
    'allocated_total', v_total,
    'transaction_amount', v_tx.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.match_bank_transaction_allocations(UUID, JSONB, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction_allocations(UUID, JSONB, NUMERIC, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.match_bank_transaction_allocations IS
  'Atomically allocates one bank transaction to one or more bookings and writes ledger/allocation/audit evidence.';
