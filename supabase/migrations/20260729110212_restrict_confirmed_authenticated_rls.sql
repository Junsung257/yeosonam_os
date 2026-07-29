-- P0 revenue rescue: replace global authenticated access on internal tables
-- with a database-backed admin check. service_role continues to bypass RLS.
--
-- Production evidence at 2026-07-29:
--   * bookings/customers contained PII and financial data.
--   * every authenticated user matched the previous policies.
--   * all current bookings/customers have tenant_id IS NULL, so a tenant-only
--     policy would deny the legitimate single-operator admin workflow.
-- This is therefore a minimal admin-only quarantine until tenant ownership is
-- backfilled and a tenant policy can be proven with real fixtures.

CREATE OR REPLACE FUNCTION public.yeosonam_is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = (SELECT auth.uid())
  )
$$;

REVOKE ALL ON FUNCTION public.yeosonam_is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.yeosonam_is_admin_user() TO authenticated, service_role;

DROP POLICY IF EXISTS bookings_access ON public.bookings;
DROP POLICY IF EXISTS customers_access ON public.customers;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'ai_responses',
    'qa_inquiries',
    'raw_documents',
    'secure_chats',
    'tenants',
    'transactions'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_access ON public.%I',
      target_table
    );
  END LOOP;
END
$$;

CREATE POLICY bookings_admin_only
  ON public.bookings
  FOR ALL
  TO authenticated
  USING ((SELECT public.yeosonam_is_admin_user()))
  WITH CHECK ((SELECT public.yeosonam_is_admin_user()));

CREATE POLICY customers_admin_only
  ON public.customers
  FOR ALL
  TO authenticated
  USING ((SELECT public.yeosonam_is_admin_user()))
  WITH CHECK ((SELECT public.yeosonam_is_admin_user()));

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'ai_responses',
    'qa_inquiries',
    'raw_documents',
    'secure_chats',
    'tenants',
    'transactions'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((SELECT public.yeosonam_is_admin_user())) WITH CHECK ((SELECT public.yeosonam_is_admin_user()))',
      target_table || '_admin_only',
      target_table
    );
  END LOOP;
END
$$;
