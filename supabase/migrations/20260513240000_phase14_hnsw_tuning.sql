-- Phase 14 P14-2: pgvector HNSW 자동 튜닝 + pg_prewarm
-- 박제일: 2026-05-13

CREATE EXTENSION IF NOT EXISTS pg_prewarm;

CREATE OR REPLACE VIEW pgvector_index_stats AS
SELECT
  s.schemaname,
  s.relname    AS tablename,
  s.indexrelname AS indexname,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  s.idx_scan      AS scans,
  s.idx_tup_read  AS rows_read,
  s.idx_tup_fetch AS rows_fetched
FROM pg_stat_user_indexes s
JOIN pg_indexes i ON s.indexrelname = i.indexname AND s.schemaname = i.schemaname
WHERE i.indexdef ILIKE '%using hnsw%' OR i.indexdef ILIKE '%using ivfflat%';

CREATE OR REPLACE FUNCTION prewarm_vector_indexes()
RETURNS TABLE(index_name text, blocks_loaded bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND (indexdef ILIKE '%using hnsw%' OR indexdef ILIKE '%using ivfflat%')
  LOOP
    BEGIN
      RETURN QUERY SELECT idx.indexname::text, pg_prewarm(idx.indexname::regclass, 'buffer')::bigint;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION prewarm_vector_indexes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prewarm_vector_indexes() TO service_role;
