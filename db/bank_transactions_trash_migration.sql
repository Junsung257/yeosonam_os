-- ═══════════════════════════════════════════════════════════════════
-- bank_transactions: Soft Delete (status + deleted_at) 컬럼 추가
-- capital_entries:   자본금 투입 이력 테이블 신규 생성
-- ═══════════════════════════════════════════════════════════════════

-- 1. bank_transactions soft-delete 컬럼
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS status     TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'excluded')),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status
  ON bank_transactions(status);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_deleted_at
  ON bank_transactions(deleted_at) WHERE deleted_at IS NOT NULL;

-- 2. 자본금 관리 테이블
CREATE TABLE IF NOT EXISTS capital_entries (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  amount     BIGINT      NOT NULL CHECK (amount > 0),
  note       TEXT,
  entry_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE capital_entries IS
  '자본금 투입 이력. 가용자산 = (총 입금액 + SUM(amount)) - 총 출금액 계산에 사용됨.';

COMMENT ON COLUMN capital_entries.amount IS '원화 정수 (양수만 허용)';
COMMENT ON COLUMN capital_entries.note IS '입금 목적 메모 (예: 대표이사 초기 투자)';

-- 3. 기존 모든 행을 'active' 상태로 초기화 (DEFAULT이므로 NULL 없음, 방어적)
UPDATE bank_transactions SET status = 'active' WHERE status IS NULL;
