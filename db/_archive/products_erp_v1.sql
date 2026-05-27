-- ═══════════════════════════════════════════════════════════════════
-- products ERP 테이블 v1
-- selling_price = GENERATED ALWAYS AS (원가 × (1+마진율) - 할인액) STORED
-- pg_cron: 매일 자정 departure_date 지난 상품 → 'expired'
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. products 테이블 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  -- 기본키: AI 자동 생성 코드 (예: PUS-TP-MAC-05-0005)
  internal_code      VARCHAR          PRIMARY KEY,

  -- 고객 노출용 상품명
  display_name       VARCHAR          NOT NULL,

  -- 출발 지역 (한글: 부산, 인천 등)
  departure_region   VARCHAR          NOT NULL DEFAULT '부산',

  -- 랜드사 약자 (TP, LO, HN, MD 등)
  supplier_code      VARCHAR(10)      NOT NULL,

  -- 출발일
  departure_date     TIMESTAMPTZ,

  -- 원가 (도매가, 랜드사에 입금할 금액)
  net_price          INTEGER          NOT NULL CHECK (net_price > 0),

  -- 마진율: 0.10 = 10%, 0.085 = 8.5%
  margin_rate        NUMERIC(6,4)     NOT NULL DEFAULT 0.10
    CHECK (margin_rate >= 0 AND margin_rate <= 1),

  -- 추가 할인액 (선택)
  discount_amount    INTEGER          NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),

  -- 판매가 자동 계산: ROUND(net_price × (1 + margin_rate)) - discount_amount
  selling_price      INTEGER
    GENERATED ALWAYS AS (
      (ROUND(net_price * (1 + margin_rate)) - discount_amount)::INTEGER
    ) STORED,

  -- AI 자동 태그 (예: {'소규모', '노팁', '마카오'})
  ai_tags            TEXT[]           NOT NULL DEFAULT '{}',

  -- 상태: draft → active → expired / cancelled
  status             VARCHAR          NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),

  -- 내부 메모 (관리자용, 고객 비노출)
  internal_memo      TEXT,

  -- 원본 파일명 (업로드 추적)
  source_filename    TEXT,

  created_at         TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT now()
);

COMMENT ON TABLE products IS
  'ERP 상품 원장. internal_code(PUS-TP-MAC-05-0005) 기준. selling_price는 자동 계산 컬럼.';
COMMENT ON COLUMN products.net_price       IS '원가(도매가) — 랜드사 입금 기준';
COMMENT ON COLUMN products.selling_price   IS '판매가 = ROUND(net_price*(1+margin_rate)) - discount_amount (STORED 자동계산)';
COMMENT ON COLUMN products.margin_rate     IS '마진율 소수점: 10% → 0.10';

-- ── 2. 인덱스 ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_status
  ON products(status);

CREATE INDEX IF NOT EXISTS idx_products_departure_date
  ON products(departure_date);

CREATE INDEX IF NOT EXISTS idx_products_supplier_code
  ON products(supplier_code);

-- internal_code prefix 검색용 (시퀀스 발급에 사용)
CREATE INDEX IF NOT EXISTS idx_products_internal_code_prefix
  ON products(internal_code text_pattern_ops);

-- ── 3. updated_at 자동 갱신 트리거 ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

-- ── 4. pg_cron: 매일 자정 KST 판매종료 처리 ─────────────────────────
-- pg_cron은 UTC 기준. 자정 KST = 전날 15:00 UTC
-- Supabase Dashboard → Extensions → pg_cron 활성화 필요

SELECT cron.schedule(
  'expire-products-daily',         -- 잡 이름 (중복 시 무시)
  '0 15 * * *',                    -- 매일 15:00 UTC = 00:00 KST
  $$
    UPDATE products
    SET    status     = 'expired',
           updated_at = now()
    WHERE  departure_date < now()
      AND  status NOT IN ('expired', 'cancelled');
  $$
)
ON CONFLICT DO NOTHING;            -- 이미 등록된 잡 재등록 방지

-- ── 5. travel_packages FK 연결 (이미 컬럼이 있는 경우) ───────────────
-- travel_packages.internal_code → products.internal_code
-- 기존 테이블에 FK가 없는 경우에만 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_packages_internal_code'
  ) THEN
    ALTER TABLE travel_packages
      ADD CONSTRAINT fk_packages_internal_code
      FOREIGN KEY (internal_code) REFERENCES products(internal_code)
      ON DELETE SET NULL;
  END IF;
END;
$$;
