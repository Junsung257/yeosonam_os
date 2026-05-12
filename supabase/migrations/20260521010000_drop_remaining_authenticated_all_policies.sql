-- ============================================================================
-- Drop remaining `authenticated_access` USING(true) policies (32 tables)
-- ============================================================================
-- Context (continuation of 20260521000000):
--   Of 42 always-true policies remaining, 10 are intentional public/anon
--   read or limited SELECT (blog_categories, departing_locations,
--   blog_engagement_logs/blog_search_metrics, package_reviews,
--   ai_training_logs, product_prices, land_operators, terms_templates).
--
--   The other 32 are `authenticated_access` ALL with `USING (true) WITH CHECK (true)`,
--   granting any logged-in user full R/W on internal/admin tables.
--
--   Verified across `src/`: every caller uses `supabaseAdmin` (service_role).
--   No anon client (`getSupabase()`) reaches any of these 32 tables.
--   service_role has BYPASSRLS=true, so server-side code is unaffected.
--
-- Action:
--   Drop the broad `authenticated_access` policy on each table. Add a
--   service_role-only replacement to keep RLS enabled and document intent.
-- ============================================================================

-- macro: replace authenticated_access with service_role-only policy
DO $$
DECLARE
  t text;
  p text;
  tbls text[] := ARRAY[
    'abandonment_tracking', 'automated_settlements', 'block_purchase_plans',
    'booking_segments', 'booking_tasks', 'campaign_engagements',
    'competitor_pricing', 'customer_aliases', 'customer_preferences_learned',
    'customer_unified_profile', 'daily_operations_metrics', 'demand_forecast',
    'during_trip_feedback', 'email_campaigns', 'inventory_alerts',
    'marketing_campaigns', 'marketing_logs', 'page_engagement_detailed',
    'post_trip_reviews', 'pre_trip_data', 'price_history',
    'product_comparison_events', 'promotion_usages', 'promotions',
    'recommendation_logs', 'search_queries', 'search_sessions_detailed',
    'slack_raw_events', 'supplier_communications', 'supplier_inventory',
    'supplier_performance', 'suppliers'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    p := t || '_service_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_access', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
      p, t
    );
  END LOOP;
END $$;

-- Note: post_trip_reviews (customer-submitted reviews) goes through
-- /api/reviews server route which uses supabaseAdmin. Customer never
-- touches the table directly. Same for promotion_usages / promotions
-- (server-side promo validation only).
