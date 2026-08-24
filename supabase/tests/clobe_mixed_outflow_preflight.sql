-- Behavioral assertions for the mixed Clobe outflow command. Run only in a
-- disposable database after the minimal fixture and both rollout migrations.

INSERT INTO public.bookings (
  id, tenant_id, booking_no, paid_amount, total_paid_out
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CLOBE-PAYOUT', 0, 0),
  ('10000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CLOBE-REFUND', 3000000, 0),
  ('10000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'CLOBE-OTHER-TENANT', 1000000, 0),
  ('10000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CLOBE-FINALIZED', 1000000, 0),
  ('10000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CLOBE-600500', 600500, 0);

UPDATE public.bookings
SET settlement_confirmed_at = now()
WHERE booking_no = 'CLOBE-FINALIZED';

INSERT INTO public.bank_transactions (
  id, tenant_id, source, external_provider, transaction_type, amount,
  counterparty_name
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clobe_api', 'clobe', '출금', 9140000, 'mixed'),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clobe_api', 'clobe', '출금', 1000000, 'wrong-total'),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clobe_api', 'clobe', '출금', 1000000, 'cross-tenant'),
  ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clobe_api', 'clobe', '출금', 1000000, 'finalized'),
  ('20000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'clobe_api', 'clobe', '출금', 600500, 'single-refund');

SELECT public.match_clobe_outflow_allocations(
  '20000000-0000-4000-8000-000000000001',
  '[{"bookingId":"10000000-0000-4000-8000-000000000001","amount":7640000,"allocationType":"payout"},{"bookingId":"10000000-0000-4000-8000-000000000002","amount":1500000,"allocationType":"refund"}]'::JSONB,
  'preflight:match:mixed',
  'preflight',
  '9.14m mixed outflow'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bank_transaction_allocations WHERE bank_transaction_id = '20000000-0000-4000-8000-000000000001' AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'mixed allocation did not create exactly two active allocations';
  END IF;
  IF (SELECT total_paid_out FROM public.bookings WHERE booking_no = 'CLOBE-PAYOUT') <> 7640000 THEN
    RAISE EXCEPTION 'supplier payout projection is incorrect';
  END IF;
  IF (SELECT paid_amount FROM public.bookings WHERE booking_no = 'CLOBE-REFUND') <> 1500000 THEN
    RAISE EXCEPTION 'customer refund projection is incorrect';
  END IF;
  IF (SELECT match_status FROM public.bank_transactions WHERE id = '20000000-0000-4000-8000-000000000001') <> 'manual' THEN
    RAISE EXCEPTION 'transaction was not marked manual after allocation';
  END IF;
END;
$$;

-- An exact retry must return the stored result without double-writing.
SELECT public.match_clobe_outflow_allocations(
  '20000000-0000-4000-8000-000000000001',
  '[{"bookingId":"10000000-0000-4000-8000-000000000001","amount":7640000,"allocationType":"payout"},{"bookingId":"10000000-0000-4000-8000-000000000002","amount":1500000,"allocationType":"refund"}]'::JSONB,
  'preflight:match:mixed',
  'preflight',
  '9.14m mixed outflow'
);

DO $$
DECLARE
  v_failed BOOLEAN := FALSE;
BEGIN
  IF (SELECT count(*) FROM public.bank_transaction_allocations WHERE bank_transaction_id = '20000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'idempotent replay created duplicate allocations';
  END IF;

  BEGIN
    PERFORM public.match_clobe_outflow_allocations(
      '20000000-0000-4000-8000-000000000001',
      '[{"bookingId":"10000000-0000-4000-8000-000000000001","amount":9140000,"allocationType":"payout"}]'::JSONB,
      'preflight:match:mixed', 'preflight', 'conflicting retry'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'idempotency conflict was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  v_failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.match_clobe_outflow_allocations(
      '20000000-0000-4000-8000-000000000002',
      '[{"bookingId":"10000000-0000-4000-8000-000000000001","amount":900000,"allocationType":"payout"}]'::JSONB,
      'preflight:wrong-total', 'preflight', NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'non-exact allocation total was accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bank_transaction_allocations WHERE bank_transaction_id = '20000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'failed exact-sum command left a partial allocation';
  END IF;
END;
$$;

DO $$
DECLARE
  v_failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.match_clobe_outflow_allocations(
      '20000000-0000-4000-8000-000000000003',
      '[{"bookingId":"10000000-0000-4000-8000-000000000003","amount":1000000,"allocationType":"payout"}]'::JSONB,
      'preflight:cross-tenant', 'preflight', NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'cross-tenant allocation was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  v_failed BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.match_clobe_outflow_allocations(
      '20000000-0000-4000-8000-000000000004',
      '[{"bookingId":"10000000-0000-4000-8000-000000000004","amount":1000000,"allocationType":"refund"}]'::JSONB,
      'preflight:finalized', 'preflight', NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'finalized booking accepted a new allocation';
  END IF;
END;
$$;

SELECT public.match_clobe_outflow_allocations(
  '20000000-0000-4000-8000-000000000005',
  '[{"bookingId":"10000000-0000-4000-8000-000000000005","amount":600500,"allocationType":"refund"}]'::JSONB,
  'preflight:600500', 'preflight', 'one immutable 600,500 outflow'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bank_transaction_allocations WHERE bank_transaction_id = '20000000-0000-4000-8000-000000000005') <> 1 THEN
    RAISE EXCEPTION '600,500 outflow was split into more than one allocation';
  END IF;
  IF (SELECT paid_amount FROM public.bookings WHERE booking_no = 'CLOBE-600500') <> 0 THEN
    RAISE EXCEPTION '600,500 refund was not applied exactly once';
  END IF;
END;
$$;

SELECT public.reverse_clobe_outflow_allocations(
  '20000000-0000-4000-8000-000000000001',
  'preflight:reverse:mixed', 'preflight', 'review again'
);

-- Exact reversal replay must also be harmless.
SELECT public.reverse_clobe_outflow_allocations(
  '20000000-0000-4000-8000-000000000001',
  'preflight:reverse:mixed', 'preflight', 'review again'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.bank_transaction_allocations WHERE bank_transaction_id = '20000000-0000-4000-8000-000000000001' AND status = 'reversed') <> 2 THEN
    RAISE EXCEPTION 'reversal did not preserve two compensating allocation records';
  END IF;
  IF (SELECT total_paid_out FROM public.bookings WHERE booking_no = 'CLOBE-PAYOUT') <> 0 THEN
    RAISE EXCEPTION 'supplier payout projection was not reversed';
  END IF;
  IF (SELECT paid_amount FROM public.bookings WHERE booking_no = 'CLOBE-REFUND') <> 3000000 THEN
    RAISE EXCEPTION 'customer refund projection was not reversed';
  END IF;
  IF (SELECT match_status FROM public.bank_transactions WHERE id = '20000000-0000-4000-8000-000000000001') <> 'unmatched' THEN
    RAISE EXCEPTION 'transaction was not reopened after reversal';
  END IF;
  IF has_function_privilege('anon', 'public.match_clobe_outflow_allocations(uuid,jsonb,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.match_clobe_outflow_allocations(uuid,jsonb,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.match_bank_transaction_allocations(uuid,jsonb,numeric,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.match_bank_transaction_allocations(uuid,jsonb,numeric,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'financial allocation RPC remains callable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.match_clobe_outflow_allocations(uuid,jsonb,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute Clobe allocation command';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clobe_outflow_allocation_commands'::regclass) THEN
    RAISE EXCEPTION 'command table RLS is disabled';
  END IF;
END;
$$;

SELECT 'clobe mixed-outflow preflight passed' AS result;
