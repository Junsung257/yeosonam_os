-- Repair legacy bank rows without double-counting booking totals.
-- A legacy manual match may have updated bookings directly while leaving no
-- bank_transaction_allocations row. This function restores evidence and, when
-- the memo resolves to another booking, transfers only the amount still
-- represented by the legacy booking totals.

CREATE OR REPLACE FUNCTION public.repair_legacy_bank_transaction_allocation(
  p_transaction_id UUID,
  p_target_booking_id UUID,
  p_matched_by TEXT DEFAULT 'clobe_sync',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx RECORD;
  v_existing RECORD;
  v_source RECORD;
  v_target RECORD;
  v_source_booking_id UUID;
  v_amount BIGINT;
  v_transfer BIGINT := 0;
  v_ledger_delta BIGINT := 0;
  v_ledger_account TEXT;
  v_allocation_type TEXT;
  v_allocation_key TEXT;
  v_notes TEXT;
BEGIN
  SELECT id, amount, transaction_type, is_refund, match_status,
         booking_id, counterparty_name
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_tx.match_status, '') = 'excluded' THEN
    RAISE EXCEPTION 'excluded bank transaction cannot be repaired' USING ERRCODE = 'P0001';
  END IF;

  SELECT bank_transaction_id, booking_id, allocated_amount, ledger_delta
    INTO v_existing
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = p_transaction_id
    AND COALESCE(status, 'active') = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.booking_id = p_target_booking_id THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_repaired', true,
        'transaction_id', p_transaction_id,
        'booking_id', p_target_booking_id,
        'allocated_amount', v_existing.allocated_amount,
        'ledger_delta', v_existing.ledger_delta
      );
    END IF;
    RAISE EXCEPTION 'bank transaction already has allocation for another booking' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, paid_amount, total_paid_out
    INTO v_target
  FROM public.bookings
  WHERE id = p_target_booking_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target booking not found or deleted: %', p_target_booking_id USING ERRCODE = 'P0002';
  END IF;

  v_source_booking_id := v_tx.booking_id;
  IF v_source_booking_id IS NOT NULL AND v_source_booking_id <> p_target_booking_id THEN
    -- Lock both rows in a stable order before calculating the transfer amount.
    IF v_source_booking_id::TEXT < p_target_booking_id::TEXT THEN
      SELECT id, paid_amount, total_paid_out INTO v_source
      FROM public.bookings WHERE id = v_source_booking_id FOR UPDATE;
      SELECT id, paid_amount, total_paid_out INTO v_target
      FROM public.bookings WHERE id = p_target_booking_id FOR UPDATE;
    ELSE
      SELECT id, paid_amount, total_paid_out INTO v_target
      FROM public.bookings WHERE id = p_target_booking_id FOR UPDATE;
      SELECT id, paid_amount, total_paid_out INTO v_source
      FROM public.bookings WHERE id = v_source_booking_id FOR UPDATE;
    END IF;
    IF v_source.id IS NULL THEN
      RAISE EXCEPTION 'source booking not found: %', v_source_booking_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_amount := GREATEST(0, COALESCE(v_tx.amount, 0));
  IF v_tx.transaction_type = '입금' AND COALESCE(v_tx.is_refund, false) = false THEN
    v_ledger_account := 'paid_amount';
    v_allocation_type := 'deposit';
    IF v_source_booking_id IS NULL THEN
      v_transfer := v_amount;
    ELSIF v_source_booking_id = p_target_booking_id THEN
      -- The same legacy booking already owns this row's total.
      v_transfer := 0;
    ELSE
      v_transfer := LEAST(v_amount, GREATEST(0, COALESCE(v_source.paid_amount, 0)));
    END IF;
    v_ledger_delta := v_transfer;
  ELSIF COALESCE(v_tx.is_refund, false) = true THEN
    v_ledger_account := 'paid_amount';
    v_allocation_type := 'refund';
    IF v_source_booking_id IS NULL THEN
      v_transfer := v_amount;
    ELSIF v_source_booking_id = p_target_booking_id THEN
      v_transfer := 0;
    ELSE
      v_transfer := LEAST(v_amount, GREATEST(0, COALESCE(v_source.paid_amount, 0)));
    END IF;
    v_ledger_delta := -v_transfer;
  ELSE
    v_ledger_account := 'total_paid_out';
    v_allocation_type := 'payout';
    IF v_source_booking_id IS NULL THEN
      v_transfer := v_amount;
    ELSIF v_source_booking_id = p_target_booking_id THEN
      v_transfer := 0;
    ELSE
      v_transfer := LEAST(v_amount, GREATEST(0, COALESCE(v_source.total_paid_out, 0)));
    END IF;
    v_ledger_delta := v_transfer;
  END IF;

  v_notes := COALESCE(p_notes, 'legacy bank transaction allocation repair');

  IF v_source_booking_id IS NOT NULL AND v_source_booking_id <> p_target_booking_id AND v_transfer > 0 THEN
    PERFORM public.update_booking_ledger(
      p_booking_id := v_source_booking_id,
      p_paid_delta := CASE
        WHEN v_allocation_type = 'deposit' THEN -v_transfer::INTEGER
        WHEN v_allocation_type = 'refund' THEN v_transfer::INTEGER
        ELSE 0
      END,
      p_payout_delta := CASE WHEN v_allocation_type = 'payout' THEN -v_transfer::INTEGER ELSE 0 END,
      p_source := 'bank_tx_legacy_reassignment',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := 'legacy-bank-repair:source:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT,
      p_memo := v_notes,
      p_created_by := p_matched_by
    );
  END IF;

  IF v_source_booking_id IS NULL OR v_source_booking_id <> p_target_booking_id THEN
    PERFORM public.update_booking_ledger(
      p_booking_id := p_target_booking_id,
      p_paid_delta := CASE
        WHEN v_allocation_type = 'deposit' THEN v_transfer::INTEGER
        WHEN v_allocation_type = 'refund' THEN -v_transfer::INTEGER
        ELSE 0
      END,
      p_payout_delta := CASE WHEN v_allocation_type = 'payout' THEN v_transfer::INTEGER ELSE 0 END,
      p_source := 'bank_tx_legacy_reassignment',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := 'legacy-bank-repair:target:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT,
      p_memo := v_notes,
      p_created_by := p_matched_by
    );
  END IF;

  v_allocation_key := 'bktxalloc:legacy:' || p_transaction_id::TEXT || ':' || p_target_booking_id::TEXT;
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
    p_target_booking_id,
    v_ledger_account,
    v_amount,
    v_ledger_delta,
    v_allocation_type,
    v_allocation_key,
    v_notes,
    p_matched_by
  );

  UPDATE public.bank_transactions
  SET booking_id = p_target_booking_id,
      match_status = 'manual',
      match_confidence = 1,
      matched_by = p_matched_by,
      matched_at = now(),
      updated_at = now()
  WHERE id = p_transaction_id;

  INSERT INTO public.ops_events (
    event_type,
    severity,
    title,
    description,
    booking_id,
    bank_transaction_id,
    target_type,
    target_id,
    status,
    metadata,
    created_by
  ) VALUES (
    'bank_transaction_repaired',
    'info',
    'Legacy bank transaction evidence repaired',
    format('%s %s repaired from legacy match', COALESCE(v_tx.counterparty_name, 'transaction'), v_amount),
    p_target_booking_id,
    p_transaction_id,
    'bank_transactions',
    p_transaction_id::TEXT,
    'resolved',
    jsonb_build_object(
      'legacy_booking_id', v_source_booking_id,
      'target_booking_id', p_target_booking_id,
      'allocation_type', v_allocation_type,
      'allocated_amount', v_amount,
      'ledger_delta', v_ledger_delta,
      'totals_preserved', v_source_booking_id IS NULL OR v_source_booking_id = p_target_booking_id,
      'actor', p_matched_by
    ),
    p_matched_by
  );

  INSERT INTO public.audit_logs (
    action,
    target_type,
    target_id,
    before_value,
    after_value,
    description,
    user_id
  ) VALUES (
    'bank_transaction_legacy_repaired',
    'bank_transactions',
    p_transaction_id::TEXT,
    jsonb_build_object('booking_id', v_source_booking_id, 'match_status', v_tx.match_status),
    jsonb_build_object(
      'booking_id', p_target_booking_id,
      'allocated_amount', v_amount,
      'ledger_delta', v_ledger_delta,
      'allocation_key', v_allocation_key,
      'actor', p_matched_by
    ),
    v_notes,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_repaired', false,
    'transaction_id', p_transaction_id,
    'previous_booking_id', v_source_booking_id,
    'booking_id', p_target_booking_id,
    'allocated_amount', v_amount,
    'ledger_delta', v_ledger_delta,
    'totals_preserved', v_source_booking_id IS NULL OR v_source_booking_id = p_target_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.repair_legacy_bank_transaction_allocation IS
  'Restores allocation evidence for legacy bank rows and safely transfers only represented totals when memo resolution changes the booking.';
