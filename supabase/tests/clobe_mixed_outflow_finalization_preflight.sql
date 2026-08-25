-- Full-schema regression for one immutable 9.14m Clobe withdrawal split
-- across two bookings, followed by evidence-gated final settlement of both.
-- Run only in a disposable database after all migrations.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES
  ('71000000-0000-4000-8000-000000000001', 'CLOBE-MIXED-PAYOUT', 'Mixed payout booking', '2026-09-05', '투어폰', 'pending', 0, 0),
  ('71000000-0000-4000-8000-000000000002', 'CLOBE-MIXED-REFUND', 'Mixed refund booking', '2026-09-06', '투어폰', 'pending', 0, 0);

INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, source_metadata
) VALUES
  (
    '72000000-0000-4000-8000-000000000001', 'clobe-mixed-deposit-a', 'mixed deposit A', '입금', 10000000,
    '입금자A', '', pg_catalog.now(), 'clobe_mcp', 'clobe', 'clobe-mixed-deposit-a', '100-038-454128',
    pg_catalog.jsonb_build_object('clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260905_혼합A_투어폰', 'settlement_key', '260905_혼합A_투어폰',
      'suggested_booking_id', '71000000-0000-4000-8000-000000000001'
    ))
  ),
  (
    '72000000-0000-4000-8000-000000000002', 'clobe-mixed-deposit-b', 'mixed deposit B', '입금', 2000000,
    '입금자B', '', pg_catalog.now(), 'clobe_mcp', 'clobe', 'clobe-mixed-deposit-b', '100-038-454128',
    pg_catalog.jsonb_build_object('clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260906_혼합B_투어폰', 'settlement_key', '260906_혼합B_투어폰',
      'suggested_booking_id', '71000000-0000-4000-8000-000000000002'
    ))
  ),
  (
    '72000000-0000-4000-8000-000000000003', 'clobe-mixed-outflow-914', 'mixed outflow 9.14m', '출금', 9140000,
    '주식회사투어폰', '260905_혼합A_투어폰', pg_catalog.now(), 'clobe_mcp', 'clobe', 'clobe-mixed-outflow-914', '100-038-454128',
    pg_catalog.jsonb_build_object('clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260905_혼합A_투어폰', 'settlement_key', '260905_혼합A_투어폰',
      'suggested_booking_id', '71000000-0000-4000-8000-000000000001'
    ))
  );

SELECT public.confirm_clobe_deposit_to_existing_booking(
  '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
  '260905_혼합A_투어폰', '260905_혼합A_투어폰', '2026-09-05', '혼합A', '투어폰',
  'clobe-mixed-deposit-a-command', 'preflight'
);
SELECT public.confirm_clobe_deposit_to_existing_booking(
  '72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002',
  '260906_혼합B_투어폰', '260906_혼합B_투어폰', '2026-09-06', '혼합B', '투어폰',
  'clobe-mixed-deposit-b-command', 'preflight'
);

INSERT INTO public.bank_transaction_allocations (
  bank_transaction_id, booking_id, ledger_account, allocated_amount,
  ledger_delta, allocation_type, status, idempotency_key, target_type,
  target_label, reason, created_by, metadata
) VALUES (
  '72000000-0000-4000-8000-000000000003', NULL, NULL, 9140000,
  NULL, 'unassigned', 'active', 'clobe-mixed-outflow-unassigned', 'unassigned',
  'Clobe 출금 검토', 'awaiting operator allocation', 'clobe_sync', '{}'::JSONB
);

SELECT public.match_clobe_outflow_allocations(
  '72000000-0000-4000-8000-000000000003',
  '[
    {"bookingId":"71000000-0000-4000-8000-000000000001","amount":7640000,"allocationType":"payout"},
    {"bookingId":"71000000-0000-4000-8000-000000000002","amount":1500000,"allocationType":"refund"}
  ]'::JSONB,
  'clobe-mixed-outflow-914-command',
  'preflight',
  '9.14m = payout 7.64m + refund 1.5m'
);

-- A historical completed command must not authorize allocations later created
-- by another path, even when booking/amount/type happen to be identical.
INSERT INTO public.bookings (
  id, booking_no, package_title, departure_date, land_operator,
  status, paid_amount, total_paid_out
) VALUES (
  '71000000-0000-4000-8000-000000000003', 'CLOBE-STALE-COMMAND',
  'Stale outflow command rejection', '2026-09-07', '투어폰', 'pending', 0, 0
);
INSERT INTO public.bank_transactions (
  id, slack_event_id, raw_message, transaction_type, amount,
  counterparty_name, memo, received_at, source, external_provider,
  external_transaction_id, account_number, booking_id, match_status,
  match_confidence, matched_by, matched_at, source_metadata
) VALUES
  (
    '72000000-0000-4000-8000-000000000004', 'clobe-stale-command-deposit', 'stale command deposit', '입금', 500000,
    '입금자C', '', pg_catalog.now(), 'clobe_mcp', 'clobe', 'clobe-stale-command-deposit', '100-038-454128',
    NULL, 'unmatched', 0, NULL, NULL,
    pg_catalog.jsonb_build_object('clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260907_혼합C_투어폰', 'settlement_key', '260907_혼합C_투어폰',
      'suggested_booking_id', '71000000-0000-4000-8000-000000000003'
    ))
  ),
  (
    '72000000-0000-4000-8000-000000000005', 'clobe-stale-command-outflow', 'stale command outflow', '출금', 100000,
    '주식회사투어폰', '260908_외부키_투어폰', pg_catalog.now(), 'clobe_mcp', 'clobe', 'clobe-stale-command-outflow', '100-038-454128',
    '71000000-0000-4000-8000-000000000003', 'manual', 1, 'other-breakdown', pg_catalog.now(),
    pg_catalog.jsonb_build_object('clobe_mcp', pg_catalog.jsonb_build_object(
      'memo', '260908_외부키_투어폰', 'settlement_key', '260908_외부키_투어폰',
      'suggested_booking_id', '71000000-0000-4000-8000-000000000003'
    ))
  );
SELECT public.confirm_clobe_deposit_to_existing_booking(
  '72000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000003',
  '260907_혼합C_투어폰', '260907_혼합C_투어폰', '2026-09-07', '혼합C', '투어폰',
  'clobe-stale-command-deposit-command', 'preflight'
);
INSERT INTO public.clobe_outflow_allocation_commands (
  idempotency_key, bank_transaction_id, request_json, result_json, completed_at
) VALUES (
  'historical-mixed-command',
  '72000000-0000-4000-8000-000000000005',
  '{"action":"match","allocations":[{"bookingId":"71000000-0000-4000-8000-000000000003","amount":100000,"allocationType":"payout"}],"actor":"preflight","notes":"historical"}'::JSONB,
  '{"ok":true}'::JSONB,
  pg_catalog.now()
);
INSERT INTO public.bank_transaction_allocations (
  bank_transaction_id, booking_id, ledger_account, allocated_amount,
  ledger_delta, allocation_type, status, idempotency_key, target_type,
  created_by, metadata
) VALUES (
  '72000000-0000-4000-8000-000000000005',
  '71000000-0000-4000-8000-000000000003',
  'total_paid_out', 100000, 100000, 'payout', 'active',
  'other-breakdown-current-allocation', 'booking', 'preflight', '{}'::JSONB
);
SELECT public.update_booking_ledger(
  '71000000-0000-4000-8000-000000000003', 0, 100000,
  'clobe_outflow_allocation', '72000000-0000-4000-8000-000000000005',
  'other-breakdown-current-allocation', 'current allocation differs from historical command', 'preflight'
);

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.finalize_clobe_booking_settlement(
      '71000000-0000-4000-8000-000000000003', TRUE,
      'must reject stale command', 'clobe-stale-command-finalize', 'preflight'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'historical mixed-outflow command authorized a different current allocation';
  END IF;
END;
$$;

SELECT public.finalize_clobe_booking_settlement(
  '71000000-0000-4000-8000-000000000001', TRUE, 'mixed payout close',
  'clobe-mixed-finalize-a', 'preflight'
);
SELECT public.finalize_clobe_booking_settlement(
  '71000000-0000-4000-8000-000000000002', TRUE, 'mixed refund close',
  'clobe-mixed-finalize-b', 'preflight'
);

DO $$
BEGIN
  IF (SELECT total_paid_out FROM public.bookings WHERE id = '71000000-0000-4000-8000-000000000001') <> 7640000 THEN
    RAISE EXCEPTION '9.14m split did not preserve exact 7.64m payout';
  END IF;
  IF (SELECT paid_amount FROM public.bookings WHERE id = '71000000-0000-4000-8000-000000000002') <> 500000 THEN
    RAISE EXCEPTION '9.14m split did not preserve exact 1.5m customer refund';
  END IF;
  IF (SELECT count(*) FROM public.bank_transaction_allocations
      WHERE bank_transaction_id = '72000000-0000-4000-8000-000000000003'
        AND status = 'active') <> 2 THEN
    RAISE EXCEPTION '9.14m provider withdrawal was not represented by exactly two active allocations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id IN ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002')
      AND settlement_confirmed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'explicit mixed-outflow evidence did not allow both booking closes';
  END IF;
  IF (SELECT count(*) FROM public.clobe_booking_settlement_snapshots
      WHERE booking_id IN ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002')
        AND event_type = 'confirmed') <> 2 THEN
    RAISE EXCEPTION 'mixed-outflow closes did not create two immutable snapshots';
  END IF;
END;
$$;

SELECT 'clobe mixed-outflow finalization preflight passed' AS result;
ROLLBACK;
