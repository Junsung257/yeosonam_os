-- Public-facing submission/reference flows are mediated by Next.js APIs.
-- Close direct browser-key table access while preserving server API behavior.

DO $$
DECLARE
  target_tables text[] := ARRAY[
    'affiliate_applications',
    'attractions',
    'package_reviews'
  ];
  target_table text;
  policy_row record;
  service_policy_name text;
BEGIN
  FOREACH target_table IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE NOTICE 'Skipping missing table public.%', target_table;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', target_table);

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND (
          'public' = ANY(roles)
          OR 'anon' = ANY(roles)
          OR 'authenticated' = ANY(roles)
          OR policyname ILIKE '%service%'
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
