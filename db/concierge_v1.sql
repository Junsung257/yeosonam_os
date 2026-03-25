-- ============================================================
-- 여소남 OS — AI 컨시어지 / Saga 결제 관제탑 DB 마이그레이션
-- 실행 순서: Supabase SQL Editor 에 전체 붙여넣기
-- ============================================================

-- ① Mock API 설정 테이블
CREATE TABLE IF NOT EXISTS mock_api_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name    TEXT NOT NULL UNIQUE,   -- 'agoda_mock' | 'klook_mock' | 'cruise_mock'
  mode        TEXT NOT NULL DEFAULT 'success'
              CHECK (mode IN ('success','fail','timeout')),
  delay_ms    INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO mock_api_configs (api_name, mode, delay_ms) VALUES
  ('agoda_mock',  'success', 0),
  ('klook_mock',  'success', 0),
  ('cruise_mock', 'success', 0)
ON CONFLICT (api_name) DO NOTHING;

-- ② 장바구니 (session_id 기반, 비회원 포함)
CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id);

-- ③ Saga 트랜잭션 마스터 (결제 단위)
CREATE TABLE IF NOT EXISTS transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   TEXT NOT NULL UNIQUE,
  session_id        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING',
      'CUSTOMER_PAID',
      'API_PROCESSING',
      'COMPLETED',
      'PARTIAL_FAIL',
      'REFUNDED'
    )),
  total_cost        INTEGER NOT NULL DEFAULT 0,   -- 원가 합계 (KRW)
  total_price       INTEGER NOT NULL DEFAULT 0,   -- 판매가 합계 (KRW)
  net_margin        INTEGER GENERATED ALWAYS AS (total_price - total_cost) STORED,
  customer_name     TEXT,
  customer_phone    TEXT,
  customer_email    TEXT,
  saga_log          JSONB NOT NULL DEFAULT '[]',  -- Saga 이벤트 배열
  vouchers          JSONB,                         -- 생성된 바우처 코드 목록
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_session  ON transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status   ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created  ON transactions(created_at DESC);

-- ④ API 개별 주문 (Saga 하위 단위, transactions 1:N)
CREATE TABLE IF NOT EXISTS api_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  api_name       TEXT NOT NULL
    CHECK (api_name IN ('agoda_mock','klook_mock','cruise_mock')),
  product_type   TEXT NOT NULL
    CHECK (product_type IN ('HOTEL','ACTIVITY','CRUISE')),
  product_id     TEXT NOT NULL,
  product_name   TEXT NOT NULL,
  cost           INTEGER NOT NULL,   -- 원가 (KRW)
  price          INTEGER NOT NULL,   -- 판매가 (KRW)
  quantity       INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','REFUNDED')),
  external_ref   TEXT,               -- mock API 반환 booking reference
  attrs          JSONB,              -- 크루즈: ship_name, cabin_class, dining, departure_port 등
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_orders_txn ON api_orders(transaction_id);
