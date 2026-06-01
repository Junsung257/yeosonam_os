-- Marketing/SEO operational tables are read and mutated through server APIs.
-- They contain keyword, ranking, indexing, policy, and optimization data that
-- should not be directly writable/readable with browser anon/authenticated keys.

DO $$
DECLARE
  target_tables text[] := ARRAY[
    'content_insights',
    'content_performance',
    'indexing_reports',
    'keyword_research_cache',
    'os_policies',
    'os_policy_audit_log',
    'programmatic_seo_topics',
    'prompt_versions',
    'publishing_policies',
    'rank_alerts',
    'rank_history',
    'serp_analysis',
    'serp_snapshots',
    'topical_clusters',
    'trend_keyword_archive'
  ];
  target_table text;
  open_policy record;
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

    FOR open_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND 'public' = ANY(roles)
        AND (
          qual = 'true'
          OR with_check = 'true'
          OR cmd = 'ALL'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', open_policy.policyname, target_table);
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
