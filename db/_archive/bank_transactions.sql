-- 여소남 OS — 은행 입출금 원장 & 정산 스키마
-- Supabase SQL Editor에서 순서대로 실행하세요
-- =============================================================

-- [Step 1] bank_transactions: 슬랙 원본 데이터 보관소 (Read-Only 원칙)
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── 불변 원본 (절대 수정 금지) ─────────────────────────────────────────
  slack_event_id    TEXT UNIQUE NOT NULL,    -- 중복 차단 핵심 (Rule 7)
  raw_message       TEXT NOT NULL,           -- 슬랙 원본 메시지 전체
  transaction_type  TEXT NOT NULL
    CHECK (transaction_type IN ('입금', '출금')),
  amount            INTEGER NOT NULL
    CHECK (amount > 0),                      -- 항상 양수
  counterparty_name TEXT,                    -- 입금자명 or 출금처명
  memo              TEXT DEFAULT '',         -- 적요 (환불 키워드 감지용 — Rule 6)
  received_at       TIMESTAMPTZ NOT NULL,    -- 실제 입출금 시각

  -- ── 매칭 결과 (업데이트 허용) ──────────────────────────────────────────
  booking_id        UUID
    REFERENCES bookings(id) ON DELETE SET NULL,
  is_refund         BOOLEAN DEFAULT FALSE,   -- Rule 6: 환불 출금 여부
  is_fee            BOOLEAN DEFAULT FALSE,   -- Rule 8: 수수료/잡비 여부
  fee_amount        INTEGER DEFAULT 0,       -- Rule 8: 수수료 금액
  match_status      TEXT DEFAULT 'unmatched'
    CHECK (match_status IN ('auto','review','unmatched','manual')),
  match_confidence  FLOAT DEFAULT 0,         -- 0.0 ~ 1.0
  matched_by        TEXT,                    -- 'auto' | 'manual' | 'retroactive'
  matched_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_status    ON bank_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_booking   ON bank_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_type      ON bank_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_bank_tx_received  ON bank_transactions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_tx_name      ON bank_transactions(counterparty_name);
CREATE INDEX IF NOT EXISTS idx_bank_tx_event     ON bank_transactions(slack_event_id);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_bank_tx_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bank_tx_updated_at ON bank_transactions;
CREATE TRIGGER trg_bank_tx_updated_at
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION update_bank_tx_timestamp();

-- RLS (인증된 사용자만 접근)
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON bank_transactions;
CREATE POLICY "authenticated_access" ON bank_transactions
  FOR ALL TO authenticated USING (true);


-- =============================================================
-- [Step 2] bookings 테이블 컬럼 추가
-- =============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paid_amount       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid_out    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status    TEXT DEFAULT '미입금',
  ADD COLUMN IF NOT EXISTS actual_payer_name TEXT;     -- Rule 4: 대리입금 처리용


-- =============================================================
-- [Step 3] 정산 현황 View (대시보드용)
-- =============================================================
CREATE OR REPLACE VIEW booking_settlement AS
SELECT
  b.id,
  b.booking_no,
  b.package_title,
  c.name                                        AS customer_name,
  b.total_price                                 AS 판매가,
  b.total_cost                                  AS 원가,
  COALESCE(b.paid_amount, 0)                   AS 총입금액,
  COALESCE(b.total_paid_out, 0)                AS 총출금액,
  -- Rule 1: 미수금
  (COALESCE(b.total_price, 0) - COALESCE(b.paid_amount, 0))          AS 미수금,
  -- Rule 2: 초과지급액
  (COALESCE(b.total_paid_out, 0) - COALESCE(b.total_cost, 0))        AS 초과지급액,
  -- Rule 8: 수수료 합계
  COALESCE((
    SELECT SUM(fee_amount)
    FROM bank_transactions
    WHERE booking_id = b.id AND is_fee = TRUE
  ), 0)                                                                AS 수수료합계,
  -- 순이익 = 판매가 - 원가 - 수수료
  (
    COALESCE(b.total_price, 0)
    - COALESCE(b.total_cost, 0)
    - COALESCE((
        SELECT SUM(fee_amount)
        FROM bank_transactions
        WHERE booking_id = b.id AND is_fee = TRUE
      ), 0)
  )                                                                    AS 순이익,
  b.payment_status,
  b.departure_date,
  b.status
FROM bookings b
LEFT JOIN customers c ON c.id = b.lead_customer_id;
