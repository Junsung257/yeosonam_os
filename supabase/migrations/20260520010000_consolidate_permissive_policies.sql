-- ============================================================================
-- Consolidate multiple_permissive_policies (Supabase advisor)
-- ============================================================================
-- The advisor flagged 135 cases where multiple PERMISSIVE policies cover
-- the same role/cmd, causing redundant per-row evaluation. More importantly,
-- many tables have `*_all USING true` policies applied to {public} role,
-- which effectively bypasses tenant isolation since PERMISSIVE policies OR
-- together.
--
-- service_role has BYPASSRLS=true (verified via pg_roles), so server-side
-- code (supabaseAdmin) is unaffected by these changes.
--
-- Two strategies applied:
--   A. Drop redundant policies on tables that have other proper policies
--   B. Replace `USING true` with proper SELECT-only public read for tables
--      where the broad policy was the only access path
-- ============================================================================

-- ─── Strategy A: Drop redundant blanket policies ─────────────────────────────
-- Each table below has at least one OTHER policy that properly handles its
-- legit access (authenticated_access, jarvis_v2_tenant_isolation, etc.)

-- agent_actions: jarvis_v2_tenant_isolation handles tenant scope
DROP POLICY IF EXISTS "agent_actions_all" ON public.agent_actions;

-- bank_transactions: authenticated_access + service_role_all + jarvis cover it
DROP POLICY IF EXISTS "Enable read for all users" ON public.bank_transactions;

-- land_operators: "Authenticated read" + "Service role full access" cover it
DROP POLICY IF EXISTS "Allow all for authenticated on land_operators" ON public.land_operators;

-- marketing_logs: authenticated_access covers it; the two duplicates are legacy
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.marketing_logs;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.marketing_logs;

-- ─── Strategy B: Replace broad policies with intent-specific ones ────────────

-- blog_categories: was the sole policy. Public blog needs read; only admins write.
DROP POLICY IF EXISTS "blog_categories_all" ON public.blog_categories;
CREATE POLICY "blog_categories_anon_read"
  ON public.blog_categories AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "blog_categories_service_write"
  ON public.blog_categories AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- departing_locations: same pattern. Public package pages read this.
DROP POLICY IF EXISTS "Allow all for authenticated on departing_locations" ON public.departing_locations;
CREATE POLICY "departing_locations_anon_read"
  ON public.departing_locations AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "departing_locations_service_write"
  ON public.departing_locations AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- blog_engagement_logs: tracker inserts from anon; only admins read.
DROP POLICY IF EXISTS "engagement_logs_all" ON public.blog_engagement_logs;
CREATE POLICY "blog_engagement_logs_anon_insert"
  ON public.blog_engagement_logs AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "blog_engagement_logs_service_all"
  ON public.blog_engagement_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- blog_search_metrics: tracker inserts from anon; only admins read.
DROP POLICY IF EXISTS "search_metrics_all" ON public.blog_search_metrics;
CREATE POLICY "blog_search_metrics_anon_insert"
  ON public.blog_search_metrics AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "blog_search_metrics_service_all"
  ON public.blog_search_metrics AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
