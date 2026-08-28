-- Close direct browser-key access to internal marketing and token tables.
-- These tables are accessed through guarded server routes with service_role.
-- Apply after 20260828120000 and 20260828130000.

BEGIN;

DO $$
DECLARE
  target_table text;
  policy_row record;
  service_policy_name text;
  target_tables text[] := ARRAY[
    'content_distributions',
    'social_platform_configs',
    'tenant_api_tokens'
  ];
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% does not exist', target_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    -- Remove historical policies that allow browser roles to read or mutate
    -- internal records. The service-role policy below is the only data path.
    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND (
          'public' = ANY(roles)
          OR 'anon' = ANY(roles)
          OR 'authenticated' = ANY(roles)
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.policyname, target_table);
    END LOOP;

    service_policy_name := target_table || '_service_role_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', service_policy_name, target_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      service_policy_name,
      target_table
    );
  END LOOP;
END $$;

COMMIT;
