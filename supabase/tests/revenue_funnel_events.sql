BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(6);

SELECT ok(
  (
    SELECT COUNT(*) = 8
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_events'
      AND column_name IN (
        'occurred_at',
        'source',
        'offer_id',
        'lead_id',
        'booking_id',
        'consent_state',
        'dedupe_key',
        'event_type'
      )
  ),
  'customer_events exposes the canonical funnel fields'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'customer_events'
      AND indexname = 'customer_events_source_dedupe_uidx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ),
  'source and dedupe key have one canonical uniqueness boundary'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.customer_events'::regclass
      AND conname = 'customer_events_event_type_check'
      AND pg_get_constraintdef(oid) LIKE '%offer_viewed%'
      AND pg_get_constraintdef(oid) LIKE '%payment_received%'
  ),
  'the canonical revenue event taxonomy is enforced'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.customer_events'::regclass
      AND conname = 'customer_events_consent_state_check'
  ),
  'consent state is constrained'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_events'
      AND cmd = 'INSERT'
      AND roles && ARRAY['anon', 'public']::name[]
  ),
  'anonymous clients cannot insert directly into the event ledger'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_events'
      AND cmd = 'SELECT'
      AND roles && ARRAY['anon', 'public']::name[]
  ),
  'anonymous clients cannot read attribution events'
);

SELECT * FROM finish();
ROLLBACK;
