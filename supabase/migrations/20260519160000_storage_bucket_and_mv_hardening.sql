-- ============================================================================
-- Storage bucket listing + Materialized view API exposure hardening
-- ============================================================================
-- Closes 2 advisor warnings:
--   - public_bucket_allows_listing: blog-assets bucket has SELECT policy that
--     lets anyone list all files. Public buckets serve via direct URL —
--     listing is unnecessary and leaks file structure.
--   - materialized_view_in_api: mv_destination_aggregates is SELECT-able by
--     anon/authenticated via PostgREST. Aggregates should be admin-only.
-- ============================================================================

-- 1. blog-assets: drop the broad SELECT policy that enables listing
--    Direct URL access still works because the bucket is public — Supabase
--    routes /storage/v1/object/public/blog-assets/<path> without RLS check.
DROP POLICY IF EXISTS blog_assets_public_read ON storage.objects;

-- 2. mv_destination_aggregates: revoke anon/authenticated SELECT
--    Materialized views aren't covered by RLS; access is GRANT-based.
REVOKE ALL ON public.mv_destination_aggregates FROM anon, authenticated;
GRANT SELECT ON public.mv_destination_aggregates TO service_role;
