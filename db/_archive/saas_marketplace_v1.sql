-- ============================================================
-- 여소남 OS — SaaS Marketplace 멀티 테넌트 스키마
-- 실행: Supabase SQL Editor에 전체 붙여넣기
-- ============================================================

-- ① 테넌트(랜드사) 마스터 테이블
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 18.00,  -- 여소남 OS 수수료 %
  status          TEXT DEFAULT 'active'
    CHECK (status IN ('active','inactive','suspended')),
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 샘플 테넌트 3개 (테스트용)
INSERT INTO tenants (name, contact_name, contact_phone, commission_rate, description) VALUES
  ('가나다 투어',    '김가나', '051-000-0001', 20.00, '동남아 전문 랜드사'),
  ('썬샤인 여행사',  '이선샤', '02-000-0002',  18.00, '일본/유럽 패키지 전문'),
  ('프리미엄 크루즈','박프리', '032-000-0003', 22.00, '지중해/알래스카 크루즈 전문')
ON CONFLICT DO NOTHING;

-- ② travel_packages에 테넌트 연결 컬럼 추가
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_price  INTEGER DEFAULT 0;  -- 랜드사 원가 (대외 비공개)

CREATE INDEX IF NOT EXISTS idx_packages_tenant ON travel_packages(tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ③ 날짜별 재고 블락 테이블
CREATE TABLE IF NOT EXISTS inventory_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  total_seats     INTEGER NOT NULL DEFAULT 0 CHECK (total_seats >= 0),
  booked_seats    INTEGER NOT NULL DEFAULT 0 CHECK (booked_seats >= 0),
  available_seats INTEGER GENERATED ALWAYS AS (total_seats - booked_seats) STORED,
  price_override  INTEGER,       -- NULL이면 travel_packages.price 사용
  status          TEXT DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLOSED','SOLDOUT')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, date),
  CONSTRAINT booked_lte_total CHECK (booked_seats <= total_seats)
);
CREATE INDEX IF NOT EXISTS idx_inventory_product_date ON inventory_blocks(product_id, date);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant        ON inventory_blocks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_available     ON inventory_blocks(available_seats) WHERE available_seats > 0;

-- ④ api_orders에 tenant_id 추가 + api_name 제약 확장
ALTER TABLE api_orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

ALTER TABLE api_orders DROP CONSTRAINT IF EXISTS api_orders_api_name_check;
ALTER TABLE api_orders ADD CONSTRAINT api_orders_api_name_check
  CHECK (api_name IN ('agoda_mock','klook_mock','cruise_mock','tenant_product'));

-- ⑤ transactions에 테넌트별 원가 분리 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tenant_cost_breakdown JSONB DEFAULT '{}';
  -- 예: { "uuid-tenant-a": 500000, "uuid-tenant-b": 300000 }
