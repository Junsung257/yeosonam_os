-- ============================================================================
-- Convert SECURITY DEFINER views → SECURITY INVOKER (29 views)
-- ============================================================================
-- Supabase advisor flagged 29 ERROR-level security_definer_view issues.
-- SECURITY DEFINER views run as the view owner (typically postgres), bypassing
-- RLS on underlying tables. When exposed via PostgREST API, anon users
-- inherit elevated privileges.
--
-- Fix: ALTER VIEW ... SET (security_invoker = on) — Postgres 15+ syntax.
-- After this change, views execute as the calling role, so RLS on underlying
-- tables is properly enforced.
--
-- All affected views are analytics/admin dashboards accessed via service_role
-- (which bypasses RLS anyway). Anon access was the vulnerability we're closing.
-- ============================================================================

DO $$
DECLARE
  vw text;
  views text[] := ARRAY[
    'ktkg_pool_candidates',
    'v_recommendation_funnel',
    'conversion_funnel',
    'active_destinations',
    'v_monthly_new_bookings',
    'customer_booking_stats',
    'content_roas_summary',
    'engagement_by_archetype_hook',
    'bank_tx_health',
    'blog_performance_view',
    'supplier_rankings',
    'product_performance_dashboard',
    'jarvis_monthly_usage',
    'influencer_performance',
    'cron_health',
    'customers_masked',
    'v_package_rank_trends',
    'v_content_kpi',
    'best_publish_slots',
    'post_engagement_current',
    'v_ltr_signals',
    'v_bookings_kpi',
    'at_risk_customers',
    'booking_tasks_health',
    'trending_hooks_7d',
    'high_value_customers',
    'campaign_roi_dashboard',
    'content_hub',
    'v_monthly_recognized_revenue'
  ];
BEGIN
  FOREACH vw IN ARRAY views LOOP
    -- Defensive: skip if view doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = vw AND c.relkind = 'v'
    ) THEN
      RAISE NOTICE 'Skipping % — view does not exist', vw;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', vw);

    RAISE NOTICE 'Set security_invoker = on for view %', vw;
  END LOOP;
END $$;
