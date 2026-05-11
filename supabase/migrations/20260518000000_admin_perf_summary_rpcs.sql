-- 어드민 속도 감사(2026-05-11) — 모든 페이지 공통 31s 백그라운드 fetch 제거.
-- 기존: AdminLayout 마운트 시 5개 fetch + getUnmatchedSummary 의 7개 count(*).
-- 신규: 단일 RPC 로 GROUP BY + FILTER 1회 round-trip.
--
-- 참고: docs/audits/2026-05-11-admin-perf-audit.md

-- ── 1) unmatched_activities summary 통합 RPC ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_unmatched_summary(p_high_occ_min INTEGER DEFAULT 3)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  counts AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored,
      COUNT(*) FILTER (WHERE status = 'added')::int   AS added,
      COUNT(*)::int                                   AS all_count,
      COUNT(*) FILTER (WHERE status = 'pending' AND occurrence_count >= p_high_occ_min)::int
        AS pending_high_occurrence,
      COUNT(*) FILTER (WHERE resolved_kind = 'auto_cron_high_confidence')::int
        AS auto_alias_resolved_total,
      COUNT(*) FILTER (WHERE resolved_kind = 'manual_link_alias')::int
        AS manual_link_alias_total
    FROM unmatched_activities
  ),
  recent AS (
    SELECT jsonb_agg(r ORDER BY r.resolved_at DESC) AS recent_arr
    FROM (
      SELECT id, activity, resolved_at, resolved_attraction_id, occurrence_count
        FROM unmatched_activities
       WHERE resolved_kind = 'auto_cron_high_confidence'
         AND resolved_at IS NOT NULL
       ORDER BY resolved_at DESC
       LIMIT 8
    ) r
  )
  SELECT jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', counts.pending,
      'ignored', counts.ignored,
      'added',   counts.added,
      'all',     counts.all_count
    ),
    'pending_high_occurrence',  counts.pending_high_occurrence,
    'auto_alias_resolved_total', counts.auto_alias_resolved_total,
    'manual_link_alias_total',  counts.manual_link_alias_total,
    'high_occurrence_threshold', p_high_occ_min,
    'recent_auto_alias', COALESCE(recent.recent_arr, '[]'::jsonb)
  )
  FROM counts, recent;
$$;

COMMENT ON FUNCTION public.get_unmatched_summary(INTEGER) IS
'어드민 사이드바 미매칭 배지용. 7개 count → 단일 GROUP BY round-trip. ERR-admin-perf-2026-05-11.';

GRANT EXECUTE ON FUNCTION public.get_unmatched_summary(INTEGER) TO authenticated, service_role;

-- ── 2) AdminLayout 사이드바 배지 통합 RPC ─────────────────────────────
-- 기존 5개 fetch (unmatched / agent-actions / ledger / packages-pending / blog-queue)
-- 의 카운트만 추출해서 1 round-trip 으로.
CREATE OR REPLACE FUNCTION public.get_admin_badge_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending_actions',
      (SELECT COUNT(*)::int FROM agent_actions WHERE status = 'pending'),
    'unmatched_pending',
      (SELECT COUNT(*)::int FROM unmatched_activities WHERE status = 'pending'),
    'pending_packages',
      (SELECT COUNT(*)::int FROM travel_packages WHERE status = 'pending'),
    'computed_at', NOW()
  );
$$;

COMMENT ON FUNCTION public.get_admin_badge_counts() IS
'어드민 레이아웃 사이드바 배지(4종). 마운트 시 1 round-trip. ERR-admin-perf-2026-05-11.';

GRANT EXECUTE ON FUNCTION public.get_admin_badge_counts() TO authenticated, service_role;

-- ── 3) high_occurrence 필터용 보강 인덱스 (status+occurrence_count) ───
-- 기존: idx_unmatched_activities_status(status, created_at desc) — high occ 필터 안 탐.
CREATE INDEX IF NOT EXISTS idx_unmatched_status_occ
  ON unmatched_activities (status, occurrence_count DESC)
  WHERE status = 'pending';

-- ── 4) resolved_kind 인덱스 (auto_alias / manual_link_alias) ───────────
CREATE INDEX IF NOT EXISTS idx_unmatched_resolved_kind
  ON unmatched_activities (resolved_kind, resolved_at DESC)
  WHERE resolved_kind IS NOT NULL;
