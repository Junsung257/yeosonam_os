BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(13);

INSERT INTO public.bookings (id, booking_no, adult_count, adult_price, adult_cost, status)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'R16-LEDGER-A', 1, 1000, 800, 'pending'),
  ('81000000-0000-4000-8000-000000000002', 'R16-LEDGER-B', 1, 1000, 800, 'pending');

SELECT lives_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000001', 100, 0,
    'admin_manual_edit', 'r16-first', 'r16-ledger-same-key', NULL, 'pgtap'
  )$$,
  'the first idempotent ledger request succeeds'
);

SELECT lives_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000001', 100, 0,
    'admin_manual_edit', 'r16-first', 'r16-ledger-same-key', NULL, 'pgtap'
  )$$,
  'an exact retry succeeds without applying again'
);

SELECT is((SELECT paid_amount FROM public.bookings WHERE booking_no = 'R16-LEDGER-A'), 100,
  'an exact retry changes the booking balance once');
SELECT is((SELECT count(*)::integer FROM public.ledger_entries WHERE idempotency_key = 'r16-ledger-same-key:paid'), 1,
  'an exact retry creates one ledger entry');
SELECT is((SELECT count(*)::integer FROM public.booking_ledger_idempotency WHERE idempotency_key = 'r16-ledger-same-key'), 1,
  'the request claim is durable and unique');

SELECT throws_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000001', 200, 0,
    'admin_manual_edit', 'r16-first', 'r16-ledger-same-key', NULL, 'pgtap'
  )$$,
  'P0001', 'booking ledger idempotency key conflict',
  'the same key with a different delta fails explicitly'
);

SELECT throws_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000002', 100, 0,
    'admin_manual_edit', 'r16-first', 'r16-ledger-same-key', NULL, 'pgtap'
  )$$,
  'P0001', 'booking ledger idempotency key conflict',
  'the same key cannot be reused for a different booking'
);
SELECT is((SELECT paid_amount FROM public.bookings WHERE booking_no = 'R16-LEDGER-B'), 0,
  'a conflicting request cannot mutate the other booking');

SELECT lives_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000001', -500, 0,
    'admin_manual_edit', 'r16-clamp', 'r16-ledger-clamp', NULL, 'pgtap'
  )$$,
  'a clamped reversal succeeds'
);
SELECT is((SELECT paid_amount FROM public.bookings WHERE booking_no = 'R16-LEDGER-A'), 0,
  'the booking balance is clamped at zero');
SELECT is((SELECT COALESCE(sum(amount), 0)::integer FROM public.ledger_entries WHERE booking_id = '81000000-0000-4000-8000-000000000001' AND account = 'paid_amount'), 0,
  'the ledger sum equals the booking balance after a clamp');
SELECT is((SELECT amount::integer FROM public.ledger_entries WHERE idempotency_key = 'r16-ledger-clamp:paid'), -100,
  'the ledger records the applied delta, not the requested delta');

SELECT throws_ok(
  $$SELECT * FROM public.update_booking_ledger(
    '81000000-0000-4000-8000-000000000001', 1, 0,
    'admin_manual_edit', 'r16-no-key', NULL, NULL, 'pgtap'
  )$$,
  'P0001', 'booking ledger idempotency key is required',
  'a non-zero mutation cannot run without an idempotency key'
);

SELECT * FROM finish();
ROLLBACK;
