-- ============================================================
-- AI 마케팅 관제소 & 수익 기반 마일리지 스키마
-- Step 3: AdAccount / KeywordPerformance / MileageTransaction
-- ============================================================
-- Supabase SQL Editor에서 실행: db/ad_marketing_mileage_v1.sql 붙여넣고 Run 클릭

-- ── 1. 광고 계정 잔액 & 일예산 (AdAccount) ────────────────────
CREATE TABLE IF NOT EXISTS ad_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL CHECK (platform IN ('naver', 'google', 'meta')),
  account_name    TEXT NOT NULL DEFAULT '',        -- 계정 별칭 (예: '여소남_네이버')
  current_balance INTEGER NOT NULL DEFAULT 0,      -- 현재 잔액 (원)
  daily_budget    INTEGER NOT NULL DEFAULT 0,      -- 일일 예산 (원)
  low_balance_threshold INTEGER NOT NULL DEFAULT 50000, -- 긴급 알림 기준 잔액 (기본 5만원)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at  TIMESTAMPTZ,                     -- 마지막 API 동기화 시각
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, account_name)
);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform ON ad_accounts(platform);

-- ── 2. 키워드 성과 (KeywordPerformance) ───────────────────────
CREATE TABLE IF NOT EXISTS keyword_performances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL CHECK (platform IN ('naver', 'google', 'meta')),
  keyword         TEXT NOT NULL,
  ad_account_id   UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
  -- 성과 집계 (누적 또는 기간별)
  total_spend     INTEGER NOT NULL DEFAULT 0,      -- 총 광고 지출액 (원)
  total_revenue   INTEGER NOT NULL DEFAULT 0,      -- 총 판매가 합계 (전환 기준)
  total_cost      INTEGER NOT NULL DEFAULT 0,      -- 총 원가 합계
  -- net_profit: GENERATED ALWAYS = 판매가 - 원가 - 지출액
  net_profit      INTEGER GENERATED ALWAYS AS
                    (total_revenue - total_cost - total_spend) STORED,
  -- ROAS: total_revenue / total_spend * 100 (%) — PostgreSQL 정수 연산
  -- 실제 ROAS는 애플리케이션 레이어에서 소수점 계산 권장
  roas_pct        INTEGER GENERATED ALWAYS AS
                    (CASE WHEN total_spend > 0
                      THEN (total_revenue * 100 / total_spend)
                      ELSE 0
                    END) STORED,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'PAUSED', 'FLAGGED_UP')),
                    -- ACTIVE: 정상 운영
                    -- PAUSED: ROAS 미달 → 광고 OFF
                    -- FLAGGED_UP: 순수익 우수 → 입찰가 상향 대상
  current_bid     INTEGER DEFAULT 0,               -- 현재 입찰가 (원/클릭)
  clicks          INTEGER NOT NULL DEFAULT 0,
  impressions     INTEGER NOT NULL DEFAULT 0,
  conversions     INTEGER NOT NULL DEFAULT 0,
  -- 롱테일 발굴 플래그
  is_longtail     BOOLEAN NOT NULL DEFAULT FALSE,  -- CPC < 100원 자동 발굴 키워드
  discovered_at   TIMESTAMPTZ,
  period_start    DATE,                            -- 성과 집계 기준 시작일
  period_end      DATE,                            -- 성과 집계 기준 종료일
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kw_platform   ON keyword_performances(platform);
CREATE INDEX IF NOT EXISTS idx_kw_status     ON keyword_performances(status);
CREATE INDEX IF NOT EXISTS idx_kw_roas       ON keyword_performances(roas_pct);
CREATE INDEX IF NOT EXISTS idx_kw_net_profit ON keyword_performances(net_profit);

-- ── 3. 마일리지 거래 (MileageTransaction) ────────────────────
CREATE TABLE IF NOT EXISTS mileage_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  -- amount: 양수(적립), 음수(사용/회수)
  amount          INTEGER NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('EARNED', 'USED', 'CLAWBACK')),
                  -- EARNED  : 전환(결제완료) 시 net_profit 5% 자동 적립
                  -- USED    : 재방문 결제 시 마일리지 사용 (마진 차감, 원가 불변)
                  -- CLAWBACK: 결제 취소/환불 시 적립 마일리지 자동 회수
  -- 마진 회계 처리
  margin_impact   INTEGER DEFAULT 0,               -- 대표 마진 변동분 (USED 시 음수)
  base_net_profit INTEGER DEFAULT 0,               -- EARNED 기준이 된 net_profit
  mileage_rate    NUMERIC(5,2) DEFAULT 5.00,       -- 적립률 (%) — 기본 5%
  memo            TEXT,
  ref_transaction_id UUID REFERENCES mileage_transactions(id) ON DELETE SET NULL,
                  -- CLAWBACK 시 원 EARNED 트랜잭션 참조
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mileage_user    ON mileage_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mileage_booking ON mileage_transactions(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mileage_type    ON mileage_transactions(type);

-- ── 4. 마일리지 잔액 View (편의용) ───────────────────────────
CREATE OR REPLACE VIEW customer_mileage_balances AS
SELECT
  user_id,
  SUM(amount) AS balance,
  SUM(CASE WHEN type = 'EARNED'   THEN amount ELSE 0 END) AS total_earned,
  SUM(CASE WHEN type = 'USED'     THEN ABS(amount) ELSE 0 END) AS total_used,
  SUM(CASE WHEN type = 'CLAWBACK' THEN ABS(amount) ELSE 0 END) AS total_clawback,
  COUNT(*) AS transaction_count,
  MAX(created_at) AS last_transaction_at
FROM mileage_transactions
GROUP BY user_id;
