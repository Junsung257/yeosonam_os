BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(3);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.match_bank_transaction_allocations(uuid,jsonb,numeric,text,text)'::regprocedure
      AND proconfig @> ARRAY['search_path=public, pg_catalog']
  ),
  'bank allocation function has a fixed search path'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.match_bank_transaction_allocations(uuid,jsonb,numeric,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot execute the bank allocation function'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.match_bank_transaction_allocations(uuid,jsonb,numeric,text,text)',
    'EXECUTE'
  ),
  'service role retains the bank allocation execution path'
);

SELECT * FROM finish();
ROLLBACK;
