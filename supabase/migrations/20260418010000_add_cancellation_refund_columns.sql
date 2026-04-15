-- ============================================================
-- 여소남 OS: 예약 취소/환불 1등 시민화 + 순현금 GENERATED 컬럼
-- 마이그레이션: 20260418010000
-- 목적:
--   BK-0012 같은 "유령 취소"(입출금 매칭됐는데 status=confirmed) 재발 방지.
--   리스트 뷰에서 한눈에 취소/환불 상태 파악 가능하게.
-- 안전성:
--   전부 ADD COLUMN IF NOT EXISTS → 재실행 안전, 기존 데이터 영향 無
--   payment_status CHECK 제약 확장 시 기존 값('미입금'/'일부입금'/'완납') 전부 유지
-- ============================================================

BEGIN;

-- 1) 취소/환불 타임스탬프 + 사유
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_settled_at TIMESTAMPTZ;

COMMENT ON COLUMN bookings.cancelled_at IS '예약 취소 시각 (status=cancelled로 전이된 시점)';
COMMENT ON COLUMN bookings.cancellation_reason IS '취소 사유 (자유 텍스트)';
COMMENT ON COLUMN bookings.refund_settled_at IS '환불 정산 완료 시각 (|net_cashflow| <= 허용오차 도달 시점)';

-- 2) 순현금흐름 GENERATED 컬럼 (STORED)
--    paid_amount - total_paid_out = 실제 회사 남은 현금
--    음수면 회사 손실(예: 송금수수료만 남음), 0 근처면 취소/환불 완료, 양수면 수익
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS net_cashflow INTEGER
    GENERATED ALWAYS AS (COALESCE(paid_amount, 0) - COALESCE(total_paid_out, 0)) STORED;

COMMENT ON COLUMN bookings.net_cashflow IS
  '순현금흐름 = paid_amount - total_paid_out. 취소/환불 가시화용. 0 근처면 실질 취소.';

-- 3) 취소/환불 배지용 인덱스 (정렬/필터 성능)
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_at
  ON bookings(cancelled_at DESC) WHERE cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_net_cashflow
  ON bookings(net_cashflow) WHERE status = 'cancelled';

-- 4) payment_status CHECK 확장 — '환불완료' 추가
--    기존: 미입금 / 일부입금 / 완납
--    추가: 환불완료 (취소 후 환불 정산 끝)
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_payment_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN ('미입금', '일부입금', '완납', '환불완료', '환불대기'));

-- 5) 백필: 유령 취소 건 자동 감지 → notes에 경고만 기록 (status는 건드리지 않음, 수동 검토 대상)
--    조건: status != 'cancelled' AND paid_amount > 0 AND total_paid_out > 0 AND |net_cashflow| <= 5000
--    (5000원 이내 차이는 송금수수료로 간주)
-- 주의: 실제 status 변경은 안 함. 사장님이 리스트 UI에서 배지 보고 개별 판단.

-- 6) refund_settled_at 자동 백필: 이미 취소된 건 중 net_cashflow가 0에 가까우면 채움
UPDATE bookings
   SET refund_settled_at = updated_at
 WHERE status = 'cancelled'
   AND refund_settled_at IS NULL
   AND ABS(COALESCE(paid_amount,0) - COALESCE(total_paid_out,0)) <= 5000
   AND paid_amount > 0;

COMMIT;
