-- Owner-approved correction for Clobe provider transaction 96537209.
--
-- The 600,500 KRW withdrawal was previously split into a 600,000 KRW
-- customer refund and a 500 KRW non-booking fee. The approved cash-settlement
-- representation is one booking outflow of 600,500 KRW. Historical allocation
-- and ledger evidence is retained through reversal/compensating entries.

DO $$
DECLARE
  v_tx RECORD;
  v_booking RECORD;
  v_alloc RECORD;
  v_active_count INTEGER;
  v_active_total BIGINT;
  v_paid BIGINT;
  v_payout BIGINT;
BEGIN
  SELECT id, amount, transaction_type, status, match_status, account_number
    INTO v_tx
  FROM public.bank_transactions
  WHERE external_provider = 'clobe'
    AND external_transaction_id = '96537209'
    AND status <> 'excluded'
  FOR UPDATE;

  IF NOT FOUND
     OR v_tx.amount <> 600500
     OR v_tx.transaction_type <> '출금'
     OR regexp_replace(COALESCE(v_tx.account_number, ''), '\D', '', 'g') <> '100038454128' THEN
    RAISE EXCEPTION 'approved Clobe 600500 withdrawal could not be resolved exactly';
  END IF;

  SELECT b.id, b.booking_no, b.paid_amount, b.total_paid_out
    INTO v_booking
  FROM public.booking_settlement_keys k
  JOIN public.bookings b ON b.id = k.booking_id
  WHERE k.normalized_key = '260623_이성순_투어폰'
    AND k.status = 'active'
    AND k.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking')
  FOR UPDATE OF b;

  IF NOT FOUND OR v_booking.booking_no <> 'BK-0126' THEN
    RAISE EXCEPTION 'approved Clobe refund booking could not be resolved exactly';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(allocated_amount), 0)
    INTO v_active_count, v_active_total
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = v_tx.id
    AND status = 'active';

  IF v_active_count = 1 AND EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = v_tx.id
      AND a.booking_id = v_booking.id
      AND a.status = 'active'
      AND a.allocation_type = 'payout'
      AND a.ledger_account = 'total_paid_out'
      AND a.allocated_amount = 600500
      AND a.ledger_delta = 600500
  ) THEN
    RAISE NOTICE 'Clobe 600500 withdrawal is already represented as one booking outflow';
  ELSE
    IF v_active_count <> 2 OR v_active_total <> 600500
       OR NOT EXISTS (
         SELECT 1
         FROM public.bank_transaction_allocations a
         WHERE a.bank_transaction_id = v_tx.id
           AND a.booking_id = v_booking.id
           AND a.status = 'active'
           AND a.allocation_type = 'refund'
           AND a.ledger_account = 'paid_amount'
           AND a.allocated_amount = 600000
           AND a.ledger_delta = -600000
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.bank_transaction_allocations a
         WHERE a.bank_transaction_id = v_tx.id
           AND a.status = 'active'
           AND a.allocation_type = 'non_booking'
           AND a.allocated_amount = 500
       ) THEN
      RAISE EXCEPTION 'Clobe 600500 withdrawal allocations changed from the approved precondition';
    END IF;

    FOR v_alloc IN
      SELECT id, booking_id, ledger_account, ledger_delta, allocation_type, idempotency_key
      FROM public.bank_transaction_allocations
      WHERE bank_transaction_id = v_tx.id
        AND status = 'active'
      FOR UPDATE
    LOOP
      IF v_alloc.booking_id IS NOT NULL
         AND v_alloc.ledger_account IS NOT NULL
         AND v_alloc.ledger_delta IS NOT NULL
         AND v_alloc.ledger_delta <> 0 THEN
        PERFORM public.update_booking_ledger(
          p_booking_id := v_alloc.booking_id,
          p_paid_delta := CASE WHEN v_alloc.ledger_account = 'paid_amount' THEN -v_alloc.ledger_delta::INTEGER ELSE 0 END,
          p_payout_delta := CASE WHEN v_alloc.ledger_account = 'total_paid_out' THEN -v_alloc.ledger_delta::INTEGER ELSE 0 END,
          p_source := 'finance_breakdown_reverse',
          p_source_ref_id := v_tx.id::TEXT,
          p_idempotency_key := 'owner-clobe-cash:96537209:reverse:' || v_alloc.id::TEXT,
          p_memo := 'Owner approved: replace split refund and fee with one 600500 booking outflow',
          p_created_by := 'owner_confirmed_20260824'
        );
      END IF;
    END LOOP;

    UPDATE public.bank_transaction_allocations
    SET status = 'reversed',
        reversed_at = now(),
        reason = COALESCE(reason, '') || ' | owner approved single 600500 booking outflow'
    WHERE bank_transaction_id = v_tx.id
      AND status = 'active';

    UPDATE public.bank_transactions
    SET booking_id = NULL,
        match_status = 'review',
        match_confidence = 0,
        matched_by = NULL,
        matched_at = NULL,
        is_refund = FALSE,
        is_fee = FALSE,
        fee_amount = 0,
        settlement_scope = 'travel',
        updated_at = now()
    WHERE id = v_tx.id;

    PERFORM public.match_bank_transaction_allocations(
      p_transaction_id := v_tx.id,
      p_allocations := jsonb_build_array(jsonb_build_object(
        'bookingId', v_booking.id,
        'amount', 600500
      )),
      p_match_confidence := 1,
      p_matched_by := 'owner_confirmed_20260824',
      p_notes := 'Owner approved: one Clobe withdrawal of 600500, including transfer fee'
    );

    UPDATE public.bank_transaction_allocations
    SET target_type = 'booking',
        target_label = '이성순 고객환불 포함 단일 출금',
        reason = 'Owner approved one cash outflow; 600000 refund plus 500 fee is not split',
        reconciliation_key = 'owner-correction:clobe-96537209',
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
          'ownerApproved', TRUE,
          'includesRefund', 600000,
          'includesTransferFee', 500,
          'approvedAt', '2026-08-24'
        )
    WHERE bank_transaction_id = v_tx.id
      AND booking_id = v_booking.id
      AND status = 'active';

    INSERT INTO public.audit_logs (
      action, target_type, target_id, before_value, after_value, description, user_id
    ) VALUES (
      'clobe_allocation_owner_corrected',
      'bank_transactions',
      v_tx.id::TEXT,
      jsonb_build_object('refund', 600000, 'fee', 500, 'allocation_count', 2),
      jsonb_build_object('booking_outflow', 600500, 'allocation_count', 1, 'booking_id', v_booking.id),
      'Owner approved a single 600500 cash outflow instead of refund/fee split',
      'owner_confirmed_20260824'
    );
  END IF;

  SELECT COALESCE(SUM(amount) FILTER (WHERE account = 'paid_amount'), 0),
         COALESCE(SUM(amount) FILTER (WHERE account = 'total_paid_out'), 0)
    INTO v_paid, v_payout
  FROM public.ledger_entries
  WHERE booking_id = v_booking.id;

  IF v_paid <> 600000 OR v_payout <> 600500 THEN
    RAISE EXCEPTION 'post-correction ledger totals are unexpected: paid %, payout %', v_paid, v_payout;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = v_booking.id
      AND COALESCE(b.paid_amount, 0) = v_paid
      AND COALESCE(b.total_paid_out, 0) = v_payout
  ) THEN
    RAISE EXCEPTION 'post-correction booking projection does not match ledger';
  END IF;
END;
$$;
