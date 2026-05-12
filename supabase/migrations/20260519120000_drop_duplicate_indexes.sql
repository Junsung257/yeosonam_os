-- ============================================================================
-- Drop duplicate indexes (10 pairs identified by Supabase performance advisor)
-- ============================================================================
-- For each duplicate pair, drop the shorter/legacy-named index and keep the
-- more descriptive/current-convention name. Duplicate indexes:
--   - Waste storage (each is a full B-tree copy)
--   - Slow down INSERTs/UPDATEs (multiple indexes must be maintained)
--   - Bloat query planner statistics
--
-- Convention applied: keep idx_<full_table_name>_<col>, drop abbreviated form.
-- For travel_packages (renamed from 'packages'), keep current name.
-- ============================================================================

-- band_import_log
DROP INDEX IF EXISTS public.idx_bil_imported;
DROP INDEX IF EXISTS public.idx_bil_status;

-- programmatic_seo_topics (PST abbreviation is older convention)
DROP INDEX IF EXISTS public.idx_pseo_dest;

-- rank_alerts (RA abbreviation is older convention)
DROP INDEX IF EXISTS public.idx_ra_unresolved;

-- rank_history
DROP INDEX IF EXISTS public.idx_rank_recent;

-- topical_clusters (TC abbreviation is older convention)
DROP INDEX IF EXISTS public.idx_tc_cluster;
DROP INDEX IF EXISTS public.idx_tc_dest;
DROP INDEX IF EXISTS public.idx_tc_pillar;

-- travel_packages (renamed from 'packages' — drop legacy-named index duplicates)
DROP INDEX IF EXISTS public.idx_packages_land_operator;
DROP INDEX IF EXISTS public.idx_packages_short_code;
