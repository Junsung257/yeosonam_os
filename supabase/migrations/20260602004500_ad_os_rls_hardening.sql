-- Ad OS tables are tenant/business-critical operational data.
-- Browser clients must use guarded server APIs; direct anon/authenticated
-- table access would allow cross-tenant reads or unauthorized mutations.

DO $$
DECLARE
  target_tables text[] := ARRAY[
    'ad_accounts',
    'ad_campaigns',
    'ad_conversion_logs',
    'ad_creatives',
    'ad_engagement_logs',
    'ad_landing_mappings',
    'ad_os_automation_runs',
    'ad_os_budget_pacing_snapshots',
    'ad_os_change_requests',
    'ad_os_channel_budgets',
    'ad_os_decision_logs',
    'ad_os_landing_evolution_queue',
    'ad_os_learning_events',
    'ad_os_product_scenarios',
    'ad_os_search_term_candidates',
    'ad_os_tenant_ad_accounts',
    'ad_os_tenant_governance',
    'ad_performance_snapshots',
    'ad_search_logs',
    'ad_traffic_logs',
    'search_ad_keyword_plans'
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
