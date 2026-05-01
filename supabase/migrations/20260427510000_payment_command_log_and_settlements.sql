-- ============================================================
-- 입출금 채팅식 매칭 — 학습 로그 + 출금 묶음 정산
-- 마이그레이션: 20260427500000
-- ============================================================
-- 목적
--  1) payment_command_log: 사장님 ⌘K 입력·결과 audit + 학습 데이터.
--     누가/언제/뭘 매칭했고, 사장님이 정정했는지(user_corrected) 추적.
--  2) land_settlements + land_settlement_bookings:
--     출금 거래 1건을 N개 booking 정산으로 묶음. 합계 검증 + 감사 추적.
-- 정책 (project_payment_command_matching.md):
--  - 출금 자동매칭 절대 금지. settlement 테이블 INSERT 는 항상 사장님 ☑로만.
--  - 학습 룰 자동 등록은 입금(transaction_type='입금') + user_corrected=false 만.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payment_command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input TEXT NOT NULL,
  parsed_date DATE,
  parsed_customer_name TEXT,
  parsed_operator_alias TEXT,
  parsed_booking_id TEXT,
  resolved_branch TEXT CHECK (resolved_branch IN ('A','B','C','D')),
  resolved_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  resolved_inflow_tx_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,
  resolved_outflow_tx_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,
  resolved_settlement_id UUID,
  user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  pattern_signature TEXT,
  score NUMERIC(4,3),
  reasons JSONB DEFAULT '[]'::jsonb,
  action TEXT NOT NULL DEFAULT 'confirm'
    CHECK (action IN ('confirm','dismiss','new_booking','operator_alias_added')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  tenant_id UUID
);

CREATE INDEX IF NOT EXISTS idx_pcl_pattern ON payment_command_log(pattern_signature);
CREATE INDEX IF NOT EXISTS idx_pcl_booking ON payment_command_log(resolved_booking_id);
CREATE INDEX IF NOT EXISTS idx_pcl_created ON payment_command_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcl_tenant  ON payment_command_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pcl_branch  ON payment_command_log(resolved_branch);

COMMENT ON TABLE payment_command_log IS
  '⌘K 매칭 명령 audit + 학습 데이터. 입금 매칭만 룰 학습 대상 (출금은 사장님 매번 confirm).';

CREATE TABLE IF NOT EXISTS land_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  land_operator_id UUID NOT NULL REFERENCES land_operators(id) ON DELETE RESTRICT,
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL,
  bundled_total INTEGER NOT NULL,
  fee_amount INTEGER NOT NULL DEFAULT 0,
  is_refund BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','reversed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  reversed_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversal_reason TEXT,
  tenant_id UUID,
  CONSTRAINT chk_settlement_balance
    CHECK (ABS(total_amount - bundled_total - fee_amount) <= 5000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_tx
  ON land_settlements(bank_transaction_id)
  WHERE status <> 'reversed';

CREATE INDEX IF NOT EXISTS idx_settlements_operator ON land_settlements(land_operator_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status   ON land_settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant   ON land_settlements(tenant_id);

COMMENT ON TABLE land_settlements IS
  '출금 거래 1건을 N개 booking 정산으로 묶는 헤더. 자동매칭 금지 — 항상 사장님 ☑로만 INSERT.';

CREATE TABLE IF NOT EXISTS land_settlement_bookings (
  settlement_id UUID NOT NULL REFERENCES land_settlements(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (settlement_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_lsb_booking ON land_settlement_bookings(booking_id);

COMMENT ON TABLE land_settlement_bookings IS
  '랜드사 정산 묶음 — settlement 와 booking N:N. 합계는 land_settlements.chk_settlement_balance 가 보장.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pcl_settlement'
  ) THEN
    ALTER TABLE payment_command_log
      ADD CONSTRAINT fk_pcl_settlement
      FOREIGN KEY (resolved_settlement_id)
      REFERENCES land_settlements(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
