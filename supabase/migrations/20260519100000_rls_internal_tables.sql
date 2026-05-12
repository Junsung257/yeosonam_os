-- ============================================================================
-- RLS for internal tables (rls_disabled_in_public ERROR fix)
-- ============================================================================
-- Supabase advisor: 18 tables in public schema with RLS disabled.
-- All are internal/operational tables (analytics, ML, telemetry, cron snapshots)
-- with zero references in src/. They are populated by:
--   - Cron jobs (cron_*, refresh_*, snapshot_*)
--   - LLM workers (service_role)
--   - DB triggers / functions
--
-- No application code uses anon/authenticated access to these tables.
-- Service-role-only RLS is the correct policy.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'flight_availability_snapshots',
    'ota_price_snapshots',
    'demand_forecast_v2',
    'os_policy_triggers',
    'card_news_publish_guards',
    'card_news_publish_decisions',
    'external_trend_posts',
    'ig_hashtag_pool',
    'ig_competitor_handles',
    'card_news_design_archetypes',
    'bandit_arms',
    'response_corrections',
    'visitor_journey_summary',
    'daily_inventory_snapshots',
    'booking_pace_aggregate',
    'jarvis_lessons',
    'jarvis_admin_preferences',
    'qa_negative_examples'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Skip if table doesn't exist (defensive)
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tbl AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE 'Skipping % — table does not exist', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      tbl || '_service_role_all',
      tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
      tbl || '_service_role_all',
      tbl
    );

    RAISE NOTICE 'Applied service-role-only RLS to %', tbl;
  END LOOP;
END $$;
