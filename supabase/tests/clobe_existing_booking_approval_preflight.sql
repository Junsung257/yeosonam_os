-- Production-shaped behavioral preflight for operator approval of an existing
-- booking suggested by an exact Clobe memo. Run only in a disposable database
-- after all migrations. Every fixture is rolled back.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_lease JSONB;
  v_completed JSONB;
BEGIN
  v_lease := public.begin_clobe_sync_run(
    NULL,
    '100-038-454128',
    '2026-08-01',
    '2026-08-31',
    'preflight',
    60
  );
  PERFORM public.checkpoint_clobe_sync_run(
    (v_lease ->> 'run_id')::UUID,
    (v_lease ->> 'lease_token')::UUID,
    NULL,
    1,
    '{"phase":"preflight"}'::JSONB,
    60
  );
  v_completed := public.complete_clobe_sync_run(
    (v_lease ->> 'run_id')::UUID,
    (v_lease ->> 'lease_token')::UUID,
    'success',
    0, 0, 0, 0, 0, 0,
    '{"preflight":true}'::JSONB
  );
  IF v_completed ->> 'status' <> 'success' THEN
    RAISE EXCEPTION 'platform-scope Clobe lease did not complete';
  END IF;
END;
$$;

INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'CLOBE-EXISTING-APPROVAL',
  'Clobe approval preflight',
  '2026-09-01',
  '투어폰',
  'pending',
  0,
  0
);

INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, source_metadata
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  'clobe-existing-approval-preflight',
  'Clobe existing-booking approval preflight',
  '입금',
  1200000,
  '입금자A',
  '',
  pg_catalog.now(),
  'clobe_mcp',
  'clobe',
  'clobe-existing-approval-preflight',
  '100-038-454128',
  pg_catalog.jsonb_build_object(
    'clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260901_테스트_투어폰',
      'settlement_key', '260901_테스트_투어폰',
      'suggested_booking_id', '61000000-0000-4000-8000-000000000001'
    )
  )
);

SELECT public.confirm_clobe_deposit_to_existing_booking(
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '260901_테스트_투어폰',
  '260901_테스트_투어폰',
  '2026-09-01',
  '테스트',
  '투어폰',
  'clobe-existing-approval-preflight-command',
  'preflight'
);

-- An exact retry must not create a second key, allocation, or ledger entry.
SELECT public.confirm_clobe_deposit_to_existing_booking(
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '260901_테스트_투어폰',
  '260901_테스트_투어폰',
  '2026-09-01',
  '테스트',
  '투어폰',
  'clobe-existing-approval-preflight-command',
  'preflight'
);

DO $$
BEGIN
  IF (SELECT paid_amount FROM public.bookings WHERE id = '61000000-0000-4000-8000-000000000001') <> 1200000 THEN
    RAISE EXCEPTION 'existing-booking approval did not project the exact deposit';
  END IF;
  IF (SELECT count(*) FROM public.booking_settlement_keys
      WHERE booking_id = '61000000-0000-4000-8000-000000000001'
        AND normalized_key = '260901_테스트_투어폰'
        AND source = 'clobe_memo_approved_booking'
        AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'existing-booking approval did not atomically claim one active key';
  END IF;
  IF (SELECT count(*) FROM public.bank_transaction_allocations
      WHERE bank_transaction_id = '62000000-0000-4000-8000-000000000001'
        AND booking_id = '61000000-0000-4000-8000-000000000001'
        AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'existing-booking approval created a missing or duplicate allocation';
  END IF;
  IF (SELECT count(*) FROM public.ledger_entries
      WHERE booking_id = '61000000-0000-4000-8000-000000000001'
        AND source_ref_id = '62000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'existing-booking approval created a missing or duplicate ledger entry';
  END IF;
  IF (SELECT count(*) FROM public.clobe_existing_booking_deposit_commands
      WHERE idempotency_key = 'clobe-existing-approval-preflight-command') <> 1 THEN
    RAISE EXCEPTION 'approval command evidence is missing or duplicated';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.confirm_clobe_deposit_to_existing_booking(uuid,uuid,text,text,date,text,text,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.confirm_clobe_deposit_to_existing_booking(uuid,uuid,text,text,date,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'existing-booking approval RPC is exposed to an untrusted role';
  END IF;
  IF NOT has_function_privilege(
       'service_role',
       'public.confirm_clobe_deposit_to_existing_booking(uuid,uuid,text,text,date,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service_role cannot execute existing-booking approval RPC';
  END IF;
END;
$$;

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.bookings
    SET settlement_confirmed_at = pg_catalog.now(),
        settlement_confirmed_by = 'legacy-bypass',
        settlement_mode = 'cash'
    WHERE id = '61000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'legacy direct settlement update bypassed the Clobe command gate';
  END IF;
END;
$$;

-- A provider-key correction left in review must block final settlement even
-- when the old allocation is still attached to the booking.
UPDATE public.bank_transactions
SET match_status = 'review',
    source_metadata = pg_catalog.jsonb_set(
      source_metadata,
      '{clobe_mcp,settlement_key}',
      '"260902_다른키_투어폰"'::JSONB,
      TRUE
    )
WHERE id = '62000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.finalize_clobe_booking_settlement(
      '61000000-0000-4000-8000-000000000001',
      TRUE,
      'must fail while memo review is open',
      'clobe-existing-approval-preflight-conflict-finalize',
      'preflight'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'memo-key review state did not block final settlement';
  END IF;
END;
$$;

UPDATE public.bank_transactions
SET match_status = 'auto',
    source_metadata = pg_catalog.jsonb_set(
      source_metadata,
      '{clobe_mcp,settlement_key}',
      '"260901_테스트_투어폰"'::JSONB,
      TRUE
    )
WHERE id = '62000000-0000-4000-8000-000000000001';

SELECT public.finalize_clobe_booking_settlement(
  '61000000-0000-4000-8000-000000000001',
  TRUE,
  'preflight close',
  'clobe-existing-approval-preflight-finalize',
  'preflight'
);

DO $$
DECLARE
  v_snapshot_id UUID;
  v_mutation_blocked BOOLEAN := FALSE;
BEGIN
  IF (SELECT settlement_confirmed_at FROM public.bookings
      WHERE id = '61000000-0000-4000-8000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'fully evidenced Clobe settlement did not finalize';
  END IF;
  SELECT id INTO v_snapshot_id
  FROM public.clobe_booking_settlement_snapshots
  WHERE booking_id = '61000000-0000-4000-8000-000000000001'
    AND event_type = 'confirmed'
    AND inflow_amount = 1200000
    AND outflow_amount = 0
    AND net_profit = 1200000;
  IF v_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'final settlement immutable snapshot is missing or inaccurate';
  END IF;
  BEGIN
    UPDATE public.clobe_booking_settlement_snapshots
    SET net_profit = 0
    WHERE id = v_snapshot_id;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_mutation_blocked := TRUE;
  END;
  IF NOT v_mutation_blocked THEN
    RAISE EXCEPTION 'final settlement snapshot was mutable';
  END IF;
END;
$$;

-- A deposit that was already allocated by the legacy command must only gain
-- the authoritative key; paid_amount and ledger evidence must not double.
INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES (
  '61000000-0000-4000-8000-000000000002',
  'CLOBE-EXISTING-PROMOTION',
  'Clobe legacy promotion preflight',
  '2026-09-02',
  '투어폰',
  'pending',
  0,
  0
);

INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, source_metadata
) VALUES (
  '62000000-0000-4000-8000-000000000002',
  'clobe-existing-promotion-preflight',
  'Clobe legacy promotion preflight',
  '입금',
  600000,
  '입금자B',
  '',
  pg_catalog.now(),
  'clobe_mcp',
  'clobe',
  'clobe-existing-promotion-preflight',
  '100-038-454128',
  pg_catalog.jsonb_build_object(
    'clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260902_테스트2_투어폰',
      'settlement_key', '260902_테스트2_투어폰',
      'suggested_booking_id', '61000000-0000-4000-8000-000000000002'
    )
  )
);

SELECT public.match_bank_transaction_allocations(
  '62000000-0000-4000-8000-000000000002',
  '[{"bookingId":"61000000-0000-4000-8000-000000000002","amount":600000}]'::JSONB,
  1,
  'legacy-preflight',
  'legacy allocation before authoritative-key promotion'
);

SELECT public.confirm_clobe_deposit_to_existing_booking(
  '62000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002',
  '260902_테스트2_투어폰',
  '260902_테스트2_투어폰',
  '2026-09-02',
  '테스트2',
  '투어폰',
  'clobe-existing-promotion-preflight-command',
  'preflight'
);

DO $$
BEGIN
  IF (SELECT paid_amount FROM public.bookings WHERE id = '61000000-0000-4000-8000-000000000002') <> 600000 THEN
    RAISE EXCEPTION 'legacy allocation promotion double-posted or lost paid_amount';
  END IF;
  IF (SELECT count(*) FROM public.ledger_entries
      WHERE booking_id = '61000000-0000-4000-8000-000000000002'
        AND source_ref_id = '62000000-0000-4000-8000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'legacy allocation promotion duplicated ledger evidence';
  END IF;
  IF (SELECT count(*) FROM public.booking_settlement_keys
      WHERE booking_id = '61000000-0000-4000-8000-000000000002'
        AND normalized_key = '260902_테스트2_투어폰'
        AND source = 'clobe_memo_approved_booking'
        AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'legacy allocation promotion did not claim the authoritative key';
  END IF;
END;
$$;

-- A legacy allocation without matching ledger evidence must not be promoted
-- into an approved Clobe settlement-key owner.
INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES (
  '61000000-0000-4000-8000-000000000004',
  'CLOBE-EXISTING-MISSING-LEDGER',
  'Clobe missing-ledger rejection preflight',
  '2026-09-04',
  '투어폰',
  'pending',
  0,
  0
);

INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, booking_id, match_status,
  source_metadata
) VALUES (
  '62000000-0000-4000-8000-000000000004',
  'clobe-existing-missing-ledger-preflight',
  'Clobe missing-ledger rejection preflight',
  '입금',
  800000,
  '입금자D',
  '260904_테스트4_투어폰',
  pg_catalog.now(),
  'clobe_mcp',
  'clobe',
  'clobe-existing-missing-ledger-preflight',
  '100-038-454128',
  '61000000-0000-4000-8000-000000000004',
  'manual',
  pg_catalog.jsonb_build_object(
    'clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260904_테스트4_투어폰',
      'settlement_key', '260904_테스트4_투어폰',
      'suggested_booking_id', '61000000-0000-4000-8000-000000000004'
    )
  )
);

INSERT INTO public.bank_transaction_allocations (
  bank_transaction_id, booking_id, ledger_account, allocated_amount,
  ledger_delta, allocation_type, status, idempotency_key, target_type,
  created_by, metadata
) VALUES (
  '62000000-0000-4000-8000-000000000004',
  '61000000-0000-4000-8000-000000000004',
  'paid_amount',
  800000,
  800000,
  'deposit',
  'active',
  'clobe-existing-missing-ledger-preflight-allocation',
  'booking',
  'preflight',
  '{}'::JSONB
);

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.confirm_clobe_deposit_to_existing_booking(
      '62000000-0000-4000-8000-000000000004',
      '61000000-0000-4000-8000-000000000004',
      '260904_테스트4_투어폰',
      '260904_테스트4_투어폰',
      '2026-09-04',
      '테스트4',
      '투어폰',
      'clobe-existing-missing-ledger-preflight-command',
      'preflight'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'ledger-free existing allocation was promoted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.booking_settlement_keys
    WHERE booking_id = '61000000-0000-4000-8000-000000000004'
      AND normalized_key = '260904_테스트4_투어폰'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'failed ledger-free promotion left an active key';
  END IF;
END;
$$;

-- A previously non-travel/non-booking deposit with a late canonical provider
-- memo must be converted atomically, retaining the original allocation record.
INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES (
  '61000000-0000-4000-8000-000000000003',
  'CLOBE-EXISTING-RECLASSIFY',
  'Clobe reclassification preflight',
  '2026-09-03',
  '투어폰',
  'pending',
  0,
  0
);

INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, settlement_scope, source_metadata
) VALUES (
  '62000000-0000-4000-8000-000000000003',
  'clobe-existing-reclassify-preflight',
  'Clobe existing reclassification preflight',
  '입금',
  700000,
  '입금자C',
  '과거 기타 메모',
  pg_catalog.now(),
  'clobe_mcp',
  'clobe',
  'clobe-existing-reclassify-preflight',
  '100-038-454128',
  'non_travel',
  pg_catalog.jsonb_build_object(
    'clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260903_테스트3_투어폰',
      'settlement_key', '260903_테스트3_투어폰',
      'suggested_booking_id', '61000000-0000-4000-8000-000000000003'
    )
  )
);

INSERT INTO public.bank_transaction_allocations (
  bank_transaction_id, booking_id, ledger_account, allocated_amount,
  ledger_delta, allocation_type, status, idempotency_key, target_type,
  created_by, metadata
) VALUES (
  '62000000-0000-4000-8000-000000000003',
  NULL,
  NULL,
  700000,
  NULL,
  'non_booking',
  'active',
  'clobe-existing-reclassify-preflight-allocation',
  'other_income',
  'preflight',
  '{}'::JSONB
);

SELECT public.confirm_clobe_deposit_to_existing_booking(
  '62000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000003',
  '260903_테스트3_투어폰',
  '260903_테스트3_투어폰',
  '2026-09-03',
  '테스트3',
  '투어폰',
  'clobe-existing-reclassify-preflight-command',
  'preflight'
);

DO $$
BEGIN
  IF (SELECT paid_amount FROM public.bookings WHERE id = '61000000-0000-4000-8000-000000000003') <> 700000 THEN
    RAISE EXCEPTION 'late canonical memo reclassification did not project paid_amount';
  END IF;
  IF (SELECT count(*) FROM public.bank_transaction_allocations
      WHERE bank_transaction_id = '62000000-0000-4000-8000-000000000003'
        AND status = 'active'
        AND booking_id = '61000000-0000-4000-8000-000000000003'
        AND allocation_type = 'deposit') <> 1 THEN
    RAISE EXCEPTION 'late canonical memo reclassification lacks one active booking deposit';
  END IF;
  IF (SELECT count(*) FROM public.bank_transaction_allocations
      WHERE bank_transaction_id = '62000000-0000-4000-8000-000000000003'
        AND status = 'reversed'
        AND target_type = 'other_income') <> 1 THEN
    RAISE EXCEPTION 'late canonical memo reclassification lost prior non-booking evidence';
  END IF;
END;
$$;

SELECT 'clobe existing-booking approval preflight passed' AS result;
ROLLBACK;
