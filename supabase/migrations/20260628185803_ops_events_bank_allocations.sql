-- 여소남 OS — 운영 사건 + 은행거래 배정 원장
--
-- 목적:
--   1) 예약/고객/입출금/정산 화면이 같은 운영 사건을 공유한다.
--   2) 1개 은행거래가 N개 예약에 배정되는 내역을 명시적으로 보관한다.
--   3) 매칭 확정은 bank_transactions + bookings ledger + allocation + ops_events 를
--      같은 DB 트랜잭션에서 처리한다.

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
CREATE INDEX IF NOT EXISTS idx_ops_events_open_queue
  ON public.ops_events(status, severity, created_at DESC)
  WHERE status = 'open';

COMMENT ON TABLE public.ops_events IS
  '예약·입출금·고객·정산이 공유하는 운영 사건 타임라인. 화면별 메모가 아니라 OS 작업 흐름의 공통 증거.';

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

COMMENT ON TABLE public.bank_transaction_allocations IS
  '1개 은행거래가 1개 이상 예약에 어떻게 배정됐는지 보관하는 증거 테이블. bank_transactions.booking_id 는 호환용 대표 예약만 유지.';

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
    RAISE EXCEPTION 'allocations 배열이 필요합니다' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, amount, transaction_type, is_refund, match_status, counterparty_name
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '거래를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  IF v_tx.match_status NOT IN ('unmatched', 'review', 'error') THEN
    RAISE EXCEPTION '이미 처리된 거래입니다 (match_status=%)', v_tx.match_status USING ERRCODE = 'P0001';
  END IF;

  FOR v_alloc IN
    SELECT
      (value->>'bookingId')::UUID AS booking_id,
      COALESCE((value->>'amount')::BIGINT, 0) AS amount,
      NULLIF(value->>'ledgerDelta', '')::BIGINT AS ledger_delta
    FROM jsonb_array_elements(p_allocations)
  LOOP
    IF v_alloc.booking_id IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION '각 allocation 은 bookingId + 양수 amount 가 필요합니다' USING ERRCODE = 'P0001';
    END IF;
    IF v_alloc.ledger_delta IS NOT NULL AND (v_alloc.ledger_delta < 0 OR v_alloc.ledger_delta > v_alloc.amount) THEN
      RAISE EXCEPTION 'ledgerDelta(%)는 0 이상, 배정 금액(%) 이하이어야 합니다', v_alloc.ledger_delta, v_alloc.amount USING ERRCODE = 'P0001';
    END IF;
    v_total := v_total + v_alloc.amount;
    v_count := v_count + 1;
    IF v_first_booking_id IS NULL THEN
      v_first_booking_id := v_alloc.booking_id;
    END IF;
  END LOOP;

  v_diff := v_total - COALESCE(v_tx.amount, 0);
  IF v_diff > 0 THEN
    RAISE EXCEPTION '배정 합계(%)가 거래 금액(%)을 초과합니다', v_total, v_tx.amount USING ERRCODE = 'P0001';
  END IF;
  IF v_diff < -500 THEN
    RAISE EXCEPTION '배정 합계(%)가 거래 금액(%)보다 부족합니다', v_total, v_tx.amount USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 'booking 을 찾을 수 없거나 삭제됨: %', v_alloc.booking_id USING ERRCODE = 'P0002';
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
      RAISE EXCEPTION 'ledgerDelta(%)는 배정 금액(%)을 초과할 수 없습니다', v_ledger_delta, v_alloc.amount USING ERRCODE = 'P0001';
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
      format('%s %s원 배정', COALESCE(v_tx.counterparty_name, '거래'), v_alloc.amount),
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
    COALESCE(p_notes, '은행거래 예약 배정'),
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
  '은행거래 단일/다중 예약 배정을 원자 처리한다. bank_transactions 업데이트, allocation insert, update_booking_ledger, ops_events, audit_logs 를 한 트랜잭션에 묶는다.';
