-- ============================================================
-- 여소남 OS: 정산 확정 모드 (accrual vs cash)
-- 마이그레이션: 20260422000000
-- 목적:
--   정산을 "책 덮음(settlement_confirmed_at)" 으로 마감할 때
--   어떤 기준으로 덮었는지 추적.
--
--   accrual — 견적 빌더 장부(total_cost) 기반 마감 (정식 회계)
--   cash    — 통장 대조만으로 마감 (원가 미입력, 입금−출금 = 수익)
--
--   ERPNext "Bank Reconciliation / Mint" 와 동일한 철학:
--     최종 목표는 차액 0 → 어느 쪽 기준으로든 책이 덮이면 됨.
--   단, 어떤 기준인지 감사 추적이 필요해서 컬럼 분리.
--
-- 안전성:
--   ADD COLUMN IF NOT EXISTS + DEFAULT NULL → 기존 데이터 영향 無
--   기존 확정건은 아래 백필 쿼리로 모드 복원
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT;

COMMENT ON COLUMN bookings.settlement_mode IS
  '정산 확정 모드. accrual=장부 기반, cash=통장 대조만. NULL=미확정.';

-- CHECK 제약: 허용 값만
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'bookings_settlement_mode_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_settlement_mode_check
      CHECK (settlement_mode IS NULL OR settlement_mode IN ('accrual', 'cash'));
  END IF;
END$$;

-- 기존 확정건 백필: total_cost > 0 이면 accrual, 아니면 cash
UPDATE bookings
SET settlement_mode = CASE
  WHEN COALESCE(total_cost, 0) > 0 THEN 'accrual'
  ELSE 'cash'
END
WHERE settlement_confirmed_at IS NOT NULL
  AND settlement_mode IS NULL;

COMMIT;
