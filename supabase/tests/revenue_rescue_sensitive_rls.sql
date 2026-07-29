BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(8);

CREATE TEMP TABLE revenue_rescue_sensitive_tables(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO revenue_rescue_sensitive_tables(name) VALUES
  ('ai_responses'),
  ('bookings'),
  ('customers'),
  ('qa_inquiries'),
  ('raw_documents'),
  ('secure_chats'),
  ('tenants'),
  ('transactions');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM revenue_rescue_sensitive_tables AS target
    JOIN pg_policies AS policy
      ON policy.schemaname = 'public'
     AND policy.tablename = target.name
    WHERE policy.roles @> ARRAY['authenticated']::name[]
      AND (
        COALESCE(policy.qual, '') ~ 'auth[.]role.*authenticated'
        OR policy.qual = 'true'
        OR policy.with_check = 'true'
      )
  ),
  'sensitive tables have no unconditional authenticated policy'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.yeosonam_is_admin_user()', 'EXECUTE'),
  'anonymous users cannot execute the admin membership helper'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.yeosonam_is_admin_user()', 'EXECUTE'),
  'authenticated sessions can evaluate the admin membership helper'
);

SELECT ok(
  has_function_privilege('service_role', 'public.yeosonam_is_admin_user()', 'EXECUTE'),
  'service role retains the admin helper execution path'
);

SELECT is(
  (
    SELECT COUNT(*)::integer
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (SELECT name FROM revenue_rescue_sensitive_tables)
      AND roles @> ARRAY['authenticated']::name[]
      AND COALESCE(qual, '') LIKE '%yeosonam_is_admin_user%'
  ),
  8,
  'all sensitive tables require database-backed admin membership'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('bookings', 'customers')
      AND policyname IN ('bookings_access', 'customers_access')
  ),
  'legacy globally-authenticated booking and customer policies are removed'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'ai_responses',
        'qa_inquiries',
        'raw_documents',
        'secure_chats',
        'tenants',
        'transactions'
      )
      AND policyname = 'authenticated_access'
  ),
  'legacy globally-authenticated internal-table policies are removed'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.yeosonam_is_admin_user()'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY['search_path=public, pg_catalog']
  ),
  'admin membership helper is security-definer with a fixed search path'
);

SELECT * FROM finish();
ROLLBACK;
