-- ============================================================================
-- Drop authenticated-wide `admin_all_*` policies on ad_* / creative_* tables.
-- ============================================================================
-- Context:
--   `admin_all_<table>` policies were applied to {authenticated} with
--   USING (true) and WITH CHECK (true). Since PERMISSIVE policies OR together,
--   any logged-in user (not just admins) could read/write these tables.
--
--   Server code that touches these tables is in src/lib/db/ads.ts and
--   src/lib/db/dashboard.ts. Both modules were switched to service_role
--   (supabaseAdmin) in the same PR. service_role has BYPASSRLS=true, so the
--   server-side path is unaffected.
--
--   All callers verified to be in src/app/api/** (server-only). No client
--   component imports these helpers, so no anon access is needed.
--
-- Action:
--   Drop the broad `admin_all_*` policies. Add a service_role-only
--   replacement so future migrations don't accidentally re-introduce anon
--   access. RLS stays ENABLED on every table.
-- ============================================================================

-- ad_campaigns
DROP POLICY IF EXISTS "admin_all_ad_campaigns" ON public.ad_campaigns;
DROP POLICY IF EXISTS "ad_campaigns_service_all" ON public.ad_campaigns;
CREATE POLICY "ad_campaigns_service_all"
  ON public.ad_campaigns AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ad_creatives
DROP POLICY IF EXISTS "admin_all_ad_creatives" ON public.ad_creatives;
DROP POLICY IF EXISTS "ad_creatives_service_all" ON public.ad_creatives;
CREATE POLICY "ad_creatives_service_all"
  ON public.ad_creatives AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ad_performance_snapshots
DROP POLICY IF EXISTS "admin_all_ad_perf_snapshots" ON public.ad_performance_snapshots;
DROP POLICY IF EXISTS "ad_performance_snapshots_service_all" ON public.ad_performance_snapshots;
CREATE POLICY "ad_performance_snapshots_service_all"
  ON public.ad_performance_snapshots AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- creative_performance
DROP POLICY IF EXISTS "admin_all_creative_performance" ON public.creative_performance;
DROP POLICY IF EXISTS "creative_performance_service_all" ON public.creative_performance;
CREATE POLICY "creative_performance_service_all"
  ON public.creative_performance AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- creative_edits
DROP POLICY IF EXISTS "admin_all_creative_edits" ON public.creative_edits;
DROP POLICY IF EXISTS "creative_edits_service_all" ON public.creative_edits;
CREATE POLICY "creative_edits_service_all"
  ON public.creative_edits AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- winning_patterns
DROP POLICY IF EXISTS "admin_all_winning_patterns" ON public.winning_patterns;
DROP POLICY IF EXISTS "winning_patterns_service_all" ON public.winning_patterns;
CREATE POLICY "winning_patterns_service_all"
  ON public.winning_patterns AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
