-- ============================================================
-- attractions 소프트 삭제 도입 (2026-04-26)
-- 목적: 하드 DELETE → is_active 토글로 전환. CLAUDE.md §2-3 준수.
--   - audit trail 보존 (실수 삭제 복구 가능)
--   - unmatched_activities aliases / itinerary 매칭 끊어짐 방지
-- ============================================================

ALTER TABLE attractions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 인덱스 (활성만 조회하는 일반적 쿼리 가속)
CREATE INDEX IF NOT EXISTS idx_attractions_active
  ON attractions(is_active)
  WHERE is_active = true;

COMMENT ON COLUMN attractions.is_active IS
  'CLAUDE.md §2-3 소프트 삭제. false 로 토글하면 고객/관리자 목록에서 숨김.';
