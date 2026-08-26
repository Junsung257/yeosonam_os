-- Repair the already-reviewed 9,140,000 KRW mixed Clobe withdrawal.
-- The 7,640,000 KRW supplier payout was linked to the Changwon University
-- booking, but the 1,500,000 KRW customer refund was left as an unlinked
-- pass-through allocation. Re-run the existing compensating commands so the
-- Kim Do-yeon booking cash result includes the refund without changing the
-- immutable provider transaction.

BEGIN;

-- The mixed-outflow command writes the correct refund ledger delta but its
-- legacy INSERT relies on target_type's `booking` default. Normalize that
-- evidence centrally so current and future booking-linked refunds are counted
-- as customer refunds by the finance views.
CREATE OR REPLACE FUNCTION public.normalize_booking_refund_allocation_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL
     AND NEW.allocation_type = 'refund'
     AND NEW.ledger_account = 'paid_amount'
     AND NEW.ledger_delta < 0 THEN
    NEW.target_type := 'customer_refund';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_booking_refund_allocation_target()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_normalize_booking_refund_allocation_target
  ON public.bank_transaction_allocations;
CREATE TRIGGER trg_normalize_booking_refund_allocation_target
BEFORE INSERT OR UPDATE OF
  booking_id,
  allocation_type,
  ledger_account,
  ledger_delta,
  target_type
ON public.bank_transaction_allocations
FOR EACH ROW
EXECUTE FUNCTION public.normalize_booking_refund_allocation_target();

COMMENT ON FUNCTION public.normalize_booking_refund_allocation_target()
  IS 'Normalizes a booking-linked negative paid_amount allocation to customer_refund evidence.';

DO $$
DECLARE
  v_tx RECORD;
  v_payout_booking RECORD;
  v_refund_booking RECORD;
  v_payout_customer_name TEXT;
  v_refund_customer_name TEXT;
  v_active_count INTEGER;
  v_active_total BIGINT;
  v_already_repaired BOOLEAN;
  v_payout_projection_before BIGINT;
  v_payout_ledger_before BIGINT;
  v_refund_projection_before BIGINT;
  v_refund_ledger_before BIGINT;
  v_source_ledger_count INTEGER;
  v_projection BIGINT;
  v_ledger BIGINT;
BEGIN
  -- Resolve the immutable Clobe identity, then lock and revalidate the row.
  -- Generated UUIDs are intentionally not hard-coded in this data repair.
  BEGIN
    SELECT bt.id, bt.tenant_id, bt.source, bt.external_provider,
           bt.external_transaction_id, bt.transaction_fingerprint,
           bt.account_number, bt.transaction_type, bt.amount, bt.memo,
           bt.status, bt.match_status
      INTO STRICT v_tx
    FROM public.bank_transactions bt
    WHERE bt.status = 'active'
      AND bt.external_provider = 'clobe'
      AND bt.external_transaction_id = '105941839'
      AND bt.transaction_fingerprint = 'sha256:d0f5c2b1ccac1ed0c85b0714f9388273ff8472b79b23343f1f086cb912728999'
      AND bt.account_number = '100038454128'
      AND bt.source IN ('clobe_mcp', 'clobe_api')
      AND bt.transaction_type = '출금'
      AND ABS(bt.amount) = 9140000
      AND bt.memo = '김도연(150) 창원대 (764)'
    FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'the immutable 9,140,000 KRW Clobe transaction was not found';
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION 'the immutable 9,140,000 KRW Clobe transaction is not unique';
  END;

  BEGIN
    SELECT b.id, b.tenant_id, b.lead_customer_id, b.booking_no,
           b.departure_date, b.is_deleted, b.finance_excluded,
           b.settlement_confirmed_at
      INTO STRICT v_payout_booking
    FROM public.bookings b
    WHERE b.booking_no = 'BK-0124'
      AND COALESCE(b.is_deleted, FALSE) = FALSE
      AND COALESCE(b.finance_excluded, FALSE) = FALSE
    FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'the expected payout booking BK-0124 was not found';
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION 'the payout booking BK-0124 is not unique';
  END;

  BEGIN
    SELECT b.id, b.tenant_id, b.lead_customer_id, b.booking_no,
           b.departure_date, b.is_deleted, b.finance_excluded,
           b.settlement_confirmed_at
      INTO STRICT v_refund_booking
    FROM public.bookings b
    WHERE b.booking_no = 'BK-0142'
      AND COALESCE(b.is_deleted, FALSE) = FALSE
      AND COALESCE(b.finance_excluded, FALSE) = FALSE
    FOR UPDATE;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'the expected refund booking BK-0142 was not found';
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION 'the refund booking BK-0142 is not unique';
  END;

  SELECT c.name INTO STRICT v_payout_customer_name
  FROM public.customers c
  WHERE c.id = v_payout_booking.lead_customer_id;
  SELECT c.name INTO STRICT v_refund_customer_name
  FROM public.customers c
  WHERE c.id = v_refund_booking.lead_customer_id;

  IF v_payout_customer_name <> '창원대'
     OR v_refund_customer_name <> '김도연'
     OR v_refund_booking.departure_date <> DATE '2026-07-06' THEN
    RAISE EXCEPTION 'booking identity changed; manual review is required';
  END IF;
  IF v_payout_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id
     OR v_refund_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant 9,140,000 KRW repair is forbidden';
  END IF;
  IF v_payout_booking.settlement_confirmed_at IS NOT NULL
     OR v_refund_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized booking blocks the 9,140,000 KRW repair';
  END IF;

  -- This trigger fixes future command writes. Existing misclassified rows must
  -- be explicitly audited rather than silently backfilled.
  IF EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.status = 'active'
      AND a.reversed_at IS NULL
      AND a.booking_id IS NOT NULL
      AND a.allocation_type = 'refund'
      AND a.ledger_account = 'paid_amount'
      AND a.ledger_delta < 0
      AND a.target_type IS DISTINCT FROM 'customer_refund'
  ) THEN
    RAISE EXCEPTION 'active booking-linked refund target drift requires explicit review';
  END IF;

  SELECT COALESCE(b.total_paid_out, 0),
         COALESCE((
           SELECT SUM(le.amount)
           FROM public.ledger_entries le
           WHERE le.booking_id = b.id
             AND le.account = 'total_paid_out'
         ), 0)
    INTO v_payout_projection_before, v_payout_ledger_before
  FROM public.bookings b
  WHERE b.id = v_payout_booking.id;

  SELECT COALESCE(b.paid_amount, 0),
         COALESCE((
           SELECT SUM(le.amount)
           FROM public.ledger_entries le
           WHERE le.booking_id = b.id
             AND le.account = 'paid_amount'
         ), 0)
    INTO v_refund_projection_before, v_refund_ledger_before
  FROM public.bookings b
  WHERE b.id = v_refund_booking.id;

  IF v_payout_projection_before <> v_payout_ledger_before
     OR v_refund_projection_before <> v_refund_ledger_before THEN
    RAISE EXCEPTION 'pre-existing booking projection/ledger drift blocks the repair';
  END IF;

  -- Idempotent success shape: one linked payout plus one linked refund. Do not
  -- return early: common Ledger/projection postconditions still run below.
  SELECT (
    SELECT COUNT(*) = 2
       AND COALESCE(SUM(a.allocated_amount), 0) = 9140000
       AND COUNT(*) FILTER (
         WHERE a.booking_id = v_payout_booking.id
           AND a.allocation_type = 'payout'
           AND a.target_type = 'booking'
           AND a.ledger_account = 'total_paid_out'
           AND a.ledger_delta = 7640000
           AND a.allocated_amount = 7640000
       ) = 1
       AND COUNT(*) FILTER (
         WHERE a.booking_id = v_refund_booking.id
           AND a.allocation_type = 'refund'
           AND a.target_type = 'customer_refund'
           AND a.ledger_account = 'paid_amount'
           AND a.ledger_delta = -1500000
           AND a.allocated_amount = 1500000
       ) = 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = v_tx.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
  ) INTO v_already_repaired;

  IF v_already_repaired THEN
    IF v_payout_projection_before <> 11640500
       OR v_refund_projection_before <> 0 THEN
      RAISE EXCEPTION 'idempotent allocation shape has unexpected booking totals';
    END IF;
  ELSE
    IF v_payout_projection_before <> 11640500
       OR v_refund_projection_before <> 1500000 THEN
      RAISE EXCEPTION 'unexpected pre-repair booking totals';
    END IF;

    SELECT COUNT(*), COALESCE(SUM(a.allocated_amount), 0)
      INTO v_active_count, v_active_total
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = v_tx.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL;

    IF v_active_count <> 2 OR v_active_total <> 9140000
       OR NOT EXISTS (
         SELECT 1
         FROM public.bank_transaction_allocations a
         WHERE a.bank_transaction_id = v_tx.id
           AND a.status = 'active'
           AND a.reversed_at IS NULL
           AND a.booking_id = v_payout_booking.id
           AND a.allocation_type = 'payout'
           AND a.target_type = 'booking'
           AND a.ledger_account = 'total_paid_out'
           AND a.ledger_delta = 7640000
           AND a.allocated_amount = 7640000
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.bank_transaction_allocations a
         WHERE a.bank_transaction_id = v_tx.id
           AND a.status = 'active'
           AND a.reversed_at IS NULL
           AND a.booking_id IS NULL
           AND a.allocation_type = 'non_booking'
           AND a.target_type = 'customer_refund'
           AND a.ledger_account IS NULL
           AND a.ledger_delta IS NULL
           AND a.allocated_amount = 1500000
       ) THEN
      RAISE EXCEPTION 'unexpected active allocation shape blocks the 9,140,000 KRW repair';
    END IF;

    -- The legacy reversal command trusts allocation evidence. Prove that the
    -- 7.64m allocation has exactly one correlated positive Ledger entry first.
    SELECT COUNT(*)
      INTO v_source_ledger_count
    FROM public.bank_transaction_allocations a
    JOIN public.ledger_entries le
      ON le.booking_id = a.booking_id
     AND le.account = a.ledger_account
     AND le.amount = a.ledger_delta
     AND le.source_ref_id = v_tx.id::TEXT
     AND (
       le.idempotency_key = a.idempotency_key
       OR le.idempotency_key LIKE a.idempotency_key || ':%'
       OR (
         a.idempotency_key LIKE '%:line:%'
         AND le.idempotency_key LIKE replace(a.idempotency_key, ':line:', ':apply:') || ':%'
       )
     )
    WHERE a.bank_transaction_id = v_tx.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND a.booking_id = v_payout_booking.id
      AND a.allocation_type = 'payout'
      AND a.ledger_account = 'total_paid_out'
      AND a.ledger_delta = 7640000
      AND a.allocated_amount = 7640000;

    IF v_source_ledger_count <> 1 THEN
      RAISE EXCEPTION 'the original 7,640,000 KRW payout Ledger evidence is missing or ambiguous';
    END IF;

    PERFORM public.reverse_clobe_outflow_allocations(
      v_tx.id,
      'repair:clobe-9140000-refund-link:reverse:v1',
      'codex_clobe_integrity_repair',
      '914만원 혼합 출금의 150만원 고객환불을 김도연 예약에 연결하기 위한 보상 반전'
    );

    PERFORM public.match_clobe_outflow_allocations(
      v_tx.id,
      jsonb_build_array(
        jsonb_build_object(
          'bookingId', v_payout_booking.id,
          'amount', 7640000,
          'allocationType', 'payout'
        ),
        jsonb_build_object(
          'bookingId', v_refund_booking.id,
          'amount', 1500000,
          'allocationType', 'refund'
        )
      ),
      'repair:clobe-9140000-refund-link:match:v1',
      'codex_clobe_integrity_repair',
      '914만원 = 창원대 지급 764만원 + 김도연 고객환불 150만원'
    );
  END IF;

  IF NOT (
    SELECT COUNT(*) = 2
       AND COALESCE(SUM(a.allocated_amount), 0) = 9140000
       AND COUNT(*) FILTER (
          WHERE a.booking_id = v_payout_booking.id
           AND a.allocation_type = 'payout'
           AND a.target_type = 'booking'
           AND a.ledger_account = 'total_paid_out'
           AND a.ledger_delta = 7640000
       ) = 1
       AND COUNT(*) FILTER (
          WHERE a.booking_id = v_refund_booking.id
           AND a.allocation_type = 'refund'
           AND a.target_type = 'customer_refund'
           AND a.ledger_account = 'paid_amount'
           AND a.ledger_delta = -1500000
       ) = 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = v_tx.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
  ) THEN
    RAISE EXCEPTION '9,140,000 KRW repair postcondition failed';
  END IF;

  -- Every active booking allocation produced by this repair must have one
  -- matching Ledger entry for the immutable provider transaction.
  IF EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = v_tx.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND a.booking_id IS NOT NULL
      AND a.ledger_account IS NOT NULL
      AND a.ledger_delta IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ledger_entries le
        WHERE le.booking_id = a.booking_id
          AND le.account = a.ledger_account
          AND le.amount = a.ledger_delta
          AND le.source_ref_id = v_tx.id::TEXT
          AND (
            le.idempotency_key = a.idempotency_key
            OR le.idempotency_key LIKE a.idempotency_key || ':%'
            OR (
              a.idempotency_key LIKE '%:line:%'
              AND le.idempotency_key LIKE replace(a.idempotency_key, ':line:', ':apply:') || ':%'
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'active repaired allocation is missing correlated Ledger evidence';
  END IF;

  SELECT COALESCE(b.paid_amount, 0),
         COALESCE((
           SELECT SUM(le.amount)
           FROM public.ledger_entries le
           WHERE le.booking_id = b.id
             AND le.account = 'paid_amount'
         ), 0)
    INTO v_projection, v_ledger
  FROM public.bookings b
  WHERE b.id = v_refund_booking.id;

  IF v_projection <> 0 OR v_ledger <> 0 OR v_projection <> v_ledger THEN
    RAISE EXCEPTION 'Kim Do-yeon refund projection/ledger postcondition failed (% vs %)',
      v_projection, v_ledger;
  END IF;

  SELECT COALESCE(b.total_paid_out, 0),
         COALESCE((
           SELECT SUM(le.amount)
           FROM public.ledger_entries le
           WHERE le.booking_id = b.id
             AND le.account = 'total_paid_out'
         ), 0)
    INTO v_projection, v_ledger
  FROM public.bookings b
  WHERE b.id = v_payout_booking.id;

  IF v_projection <> v_ledger
     OR v_projection <> v_payout_projection_before
     OR v_ledger <> v_payout_ledger_before THEN
    RAISE EXCEPTION 'Changwon University payout changed or drifted (% vs %, expected %)',
      v_projection, v_ledger, v_payout_projection_before;
  END IF;
END;
$$;

COMMIT;
