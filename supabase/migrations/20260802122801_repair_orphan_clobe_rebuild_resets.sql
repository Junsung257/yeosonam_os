-- Repair three orphan reset entries left by the authoritative Clobe rebuild.
-- The bookings were correctly reset to zero, but no replacement Clobe bank
-- transactions existed for them, so their ledger balances remained negative.

DO $$
DECLARE
  v_row RECORD;
  v_candidate_count INTEGER;
  v_ledger_paid BIGINT;
  v_expected_amount CONSTANT BIGINT := -2318000;
BEGIN
  WITH candidates AS (
    SELECT b.id
    FROM public.bookings b
    JOIN public.ledger_entries le
      ON le.booking_id = b.id
     AND le.account = 'paid_amount'
    WHERE COALESCE(b.is_deleted, false) = false
      AND COALESCE(b.paid_amount, 0) = 0
      AND EXISTS (
        SELECT 1
        FROM public.ledger_entries reset_entry
        WHERE reset_entry.booking_id = b.id
          AND reset_entry.source = 'bank_tx_clobe_rebuild'
          AND reset_entry.source_ref_id = 'clobe-authoritative-rebuild'
          AND reset_entry.amount = v_expected_amount
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.bank_transactions bt
        WHERE bt.booking_id = b.id
          AND bt.deleted_at IS NULL
          AND bt.status <> 'excluded'
          AND bt.external_provider = 'clobe'
      )
    GROUP BY b.id
    HAVING SUM(le.amount) = v_expected_amount
  )
  SELECT COUNT(*) INTO v_candidate_count FROM candidates;

  -- Zero means this idempotent repair has already been applied.
  IF v_candidate_count = 0 THEN
    RETURN;
  END IF;

  IF v_candidate_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 orphan Clobe reset candidates, found %', v_candidate_count;
  END IF;

  FOR v_row IN
    WITH candidates AS (
      SELECT b.id
      FROM public.bookings b
      JOIN public.ledger_entries le
        ON le.booking_id = b.id
       AND le.account = 'paid_amount'
      WHERE COALESCE(b.is_deleted, false) = false
        AND COALESCE(b.paid_amount, 0) = 0
        AND EXISTS (
          SELECT 1
          FROM public.ledger_entries reset_entry
          WHERE reset_entry.booking_id = b.id
            AND reset_entry.source = 'bank_tx_clobe_rebuild'
            AND reset_entry.source_ref_id = 'clobe-authoritative-rebuild'
            AND reset_entry.amount = v_expected_amount
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bank_transactions bt
          WHERE bt.booking_id = b.id
            AND bt.deleted_at IS NULL
            AND bt.status <> 'excluded'
            AND bt.external_provider = 'clobe'
        )
      GROUP BY b.id
      HAVING SUM(le.amount) = v_expected_amount
    )
    SELECT b.id AS booking_id, COALESCE(b.paid_amount, 0)::BIGINT AS booking_paid
    FROM public.bookings b
    JOIN candidates c ON c.id = b.id
    FOR UPDATE OF b
  LOOP

    PERFORM public.record_ledger_entry(
      p_booking_id := v_row.booking_id,
      p_account := 'paid_amount',
      p_entry_type := 'manual_adjust',
      p_amount := -v_expected_amount,
      p_source := 'bank_tx_clobe_rebuild',
      p_source_ref_id := 'clobe-authoritative-rebuild-repair',
      p_idempotency_key := 'clobe-authoritative-rebuild-repair:' || v_row.booking_id::TEXT || ':paid',
      p_memo := 'Compensate orphan reset entry with no authoritative Clobe transaction',
      p_created_by := 'system'
    );

    SELECT COALESCE(SUM(amount), 0)::BIGINT
    INTO v_ledger_paid
    FROM public.ledger_entries
    WHERE booking_id = v_row.booking_id
      AND account = 'paid_amount';

    IF v_ledger_paid <> v_row.booking_paid THEN
      RAISE EXCEPTION
        'Clobe rebuild repair did not reconcile booking %: booking=%, ledger=%',
        v_row.booking_id, v_row.booking_paid, v_ledger_paid;
    END IF;
  END LOOP;
END;
$$;
