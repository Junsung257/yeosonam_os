-- 어드민 속도 감사 Phase 1-B (2026-05-11) — customers 일괄 작업 N+1 제거.
-- 감사: docs/audits/2026-05-11-admin-perf-audit.md

-- ── 일괄 태깅 RPC — N+1 (SELECT+UPDATE × N) → 단일 UPDATE 1 round-trip ──
CREATE OR REPLACE FUNCTION public.merge_customer_tags(
  p_ids UUID[],
  p_tag TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF array_length(p_ids, 1) IS NULL OR length(coalesce(p_tag, '')) = 0 THEN
    RETURN 0;
  END IF;
  WITH upd AS (
    UPDATE customers
       SET tags = (
             SELECT ARRAY(
               SELECT DISTINCT t FROM unnest(
                 COALESCE(tags, ARRAY[]::TEXT[]) || ARRAY[p_tag]
               ) AS t
               WHERE t IS NOT NULL AND length(t) > 0
             )
           ),
           updated_at = NOW()
     WHERE id = ANY(p_ids)
       AND (deleted_at IS NULL)
     RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.merge_customer_tags(UUID[], TEXT) IS
'어드민 일괄 태깅. 기존 N+1 (SELECT+UPDATE × N) → 단일 UPDATE. ERR-admin-perf-2026-05-11.';

GRANT EXECUTE ON FUNCTION public.merge_customer_tags(UUID[], TEXT) TO authenticated, service_role;
