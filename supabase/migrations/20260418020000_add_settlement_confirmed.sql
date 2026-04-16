-- ============================================================
-- 여소남 OS: 정산 확정 플래그 (관리자 '책 덮음' 의사표시)
-- 마이그레이션: 20260418020000
-- 목적:
--   예약 건별로 "이제 이 건은 더 이상 안 봐도 됨" 표시.
--   active 목록에서 기본 숨김 + 별도 탭으로 재조회.
--   자비스 일괄 확정(bulk_confirm_settlements) 대상 플래그.
-- 안전성:
--   ADD COLUMN IF NOT EXISTS + DEFAULT NULL → 기존 데이터 영향 無
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS settlement_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_confirmed_by TEXT;

COMMENT ON COLUMN bookings.settlement_confirmed_at IS
  '정산 최종 확정 시각. NULL이면 아직 대조 중. 기본 목록에선 NOT NULL 건 숨김.';
COMMENT ON COLUMN bookings.settlement_confirmed_by IS
  '확정자 식별자 (admin/jarvis_bulk/jarvis_hitl 등)';

CREATE INDEX IF NOT EXISTS idx_bookings_settlement_confirmed
  ON bookings(settlement_confirmed_at)
  WHERE settlement_confirmed_at IS NOT NULL;

-- 출발 D-7 지나고 미확정 건 조회 최적화 (자비스 list_pending_settlements 용)
CREATE INDEX IF NOT EXISTS idx_bookings_settlement_pending
  ON bookings(departure_date)
  WHERE settlement_confirmed_at IS NULL
    AND status NOT IN ('cancelled');

COMMIT;
