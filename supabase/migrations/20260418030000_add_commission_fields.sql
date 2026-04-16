-- ============================================================
-- 여소남 OS: 랜드사 커미션 입력 필드
-- 마이그레이션: 20260418030000
-- 목적:
--   랜드사 견적서 형식 "1인 상품가 + 커미션 N%" 그대로 입력.
--   commission_rate(%) 또는 commission_amount(원) 한쪽만 입력하면 UI가 다른 쪽 자동 계산.
--   effectiveNet 계산: netOverride > rows.netPrice sum > (totalSale - commissionAmount)
-- 안전성:
--   ADD COLUMN IF NOT EXISTS + DEFAULT → 기존 데이터 영향 無
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2),        -- 10.00 = 10%
  ADD COLUMN IF NOT EXISTS commission_amount INTEGER DEFAULT 0; -- 원 단위

COMMENT ON COLUMN bookings.commission_rate IS
  '랜드사 커미션율 (%). 예: 10.00 = 10%. amount와 상호 자동 계산 (UI 레벨).';
COMMENT ON COLUMN bookings.commission_amount IS
  '랜드사 커미션 총액 (원). total_price - commission_amount = 실 원가 (netPrice 미입력 시 fallback)';

COMMIT;
