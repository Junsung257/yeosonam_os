-- ============================================================
-- 여소남 OS: quick_created 플래그 (입금→예약 원스톱 생성 추적)
-- 마이그레이션: 20260418000000
-- 목적:
--   /admin/payments 의 "신규 고객 & 예약 생성" 버튼으로 만들어진
--   customers / bookings 를 마킹. Undo(언매칭) 시 자동 청소 대상.
-- 안전성:
--   기본값 false → 기존 데이터에 영향 無
--   ADD COLUMN IF NOT EXISTS → 재실행 안전
-- ============================================================

BEGIN;

-- customers: quick-create로 생성된 고객 여부
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS quick_created BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN customers.quick_created IS
  '/admin/payments 원스톱 생성 여부. 입금 매칭 undo 시 자동 soft-delete 대상 판별용.';

-- bookings: quick-create로 생성된 예약 여부
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS quick_created BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.quick_created IS
  '/admin/payments 원스톱 생성 여부. 입금 매칭 undo 시 자동 is_deleted 처리 대상.';

-- 원스톱 생성의 트리거가 된 거래 추적 (선택)
-- undo 시 이 booking의 quick_created가 true && trigger_tx_id가 undo 대상과 일치하면 청소
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS quick_created_tx_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_quick_created_tx
  ON bookings(quick_created_tx_id)
  WHERE quick_created = true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS quick_created_tx_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_quick_created_tx
  ON customers(quick_created_tx_id)
  WHERE quick_created = true;

COMMIT;
