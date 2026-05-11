-- ============================================================================
-- Set search_path on 70 user functions (function_search_path_mutable WARN)
-- ============================================================================
-- Supabase advisor flagged 70 user-defined functions without explicit
-- search_path. Without SET search_path, the function uses the caller's
-- search_path — vulnerable to search-path injection (malicious schema
-- prepended to PATH redirects table references).
--
-- Fix: ALTER FUNCTION ... SET search_path = public, pg_catalog
--
-- Excludes extension-owned functions (pg_trgm: gin_*, gtrgm_*, similarity*,
-- word_similarity*, etc.) which are managed by the extension.
-- ============================================================================

DO $$
DECLARE
  fn_record RECORD;
  fn_count int := 0;
BEGIN
  FOR fn_record IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%'
      )
      -- Exclude extension-owned functions
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      fn_record.proname,
      fn_record.args
    );
    fn_count := fn_count + 1;
  END LOOP;

  RAISE NOTICE 'search_path applied to % functions', fn_count;
END $$;
