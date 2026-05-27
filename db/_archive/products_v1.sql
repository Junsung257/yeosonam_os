-- ============================================================
-- 여행사 ERP: products 테이블 (내부 상품 코드 자동 생성)
-- Supabase SQL Editor에서 순서대로 실행하세요.
-- ============================================================

-- ─── 1. products 테이블 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  -- 식별자: AI+시퀀스 자동 생성 (예: PUS-TP-MAC-05-0005)
  internal_code         VARCHAR        PRIMARY KEY,

  -- 기본 정보
  display_name          VARCHAR        NOT NULL,           -- 고객 노출용 상품명
  departure_region      VARCHAR        NOT NULL,           -- 출발지 한국어 (부산)
  departure_region_code VARCHAR(10)    NOT NULL,           -- 출발지 코드 (PUS)
  supplier_name         VARCHAR,                           -- 랜드사 전체명 (투어폰)
  supplier_code         VARCHAR(10)    NOT NULL,           -- 랜드사 약자 (TP)
  destination           VARCHAR,                           -- 목적지 한국어 (마카오)
  destination_code      VARCHAR(10)    NOT NULL,           -- 목적지 코드 (MAC)
  duration_days         SMALLINT       NOT NULL,           -- 여행 일수 (5)

  -- 일정
  departure_date        TIMESTAMPTZ,

  -- 가격 구조
  net_price             INTEGER        NOT NULL,           -- 원가
  margin_rate           NUMERIC(6, 4)  NOT NULL DEFAULT 0.10,  -- 마진율 (0.10 = 10%)
  discount_amount       INTEGER        NOT NULL DEFAULT 0,

  -- 판매가: 자동 계산 컬럼 (원가 × (1 + 마진율) - 할인액)
  selling_price         INTEGER GENERATED ALWAYS AS (
    CAST(ROUND((net_price * (1.0 + margin_rate)) - discount_amount) AS INTEGER)
  ) STORED,

  -- AI 분석 결과
  ai_tags               TEXT[]         DEFAULT '{}',       -- AI 자동 태그

  -- 운영 관리
  status                VARCHAR        NOT NULL DEFAULT 'draft',
  -- draft | active | expired | cancelled
  internal_memo         TEXT,
  source_filename       VARCHAR,                           -- 업로드 원본 파일명

  created_at            TIMESTAMPTZ    DEFAULT now(),
  updated_at            TIMESTAMPTZ    DEFAULT now()
);

COMMENT ON TABLE products IS '여행사 내부 상품 코드(internal_code) 기반 상품 원장';
COMMENT ON COLUMN products.internal_code IS 'PUS-TP-MAC-05-0005 형식: 출발-랜드사-목적지-일수-시퀀스';
COMMENT ON COLUMN products.selling_price IS 'GENERATED: ROUND(net_price × (1 + margin_rate)) - discount_amount';


-- ─── 2. updated_at 자동 갱신 트리거 ──────────────────────────

CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();


-- ─── 3. 자동 internal_code 생성 함수 ─────────────────────────
-- 호출 예: SELECT generate_internal_code('PUS', 'TP', 'MAC', 5);
-- 반환 예: 'PUS-TP-MAC-05-0005'
-- 동일 접두사의 마지막 시퀀스 번호 +1을 4자리 zero-padding으로 반환

CREATE OR REPLACE FUNCTION generate_internal_code(
  p_departure_code    VARCHAR,
  p_supplier_code     VARCHAR,
  p_destination_code  VARCHAR,
  p_duration_days     INT
)
RETURNS VARCHAR AS $$
DECLARE
  v_prefix   VARCHAR;
  v_last_seq INT;
BEGIN
  -- 접두사: "PUS-TP-MAC-05-"
  v_prefix :=
    UPPER(p_departure_code)
    || '-' || UPPER(p_supplier_code)
    || '-' || UPPER(p_destination_code)
    || '-' || LPAD(p_duration_days::TEXT, 2, '0')
    || '-';

  -- 동일 접두사 중 시퀀스 최대값 조회 (없으면 0)
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(internal_code FROM LENGTH(v_prefix) + 1 FOR 4)
        AS INTEGER
      )
    ),
    0
  )
  INTO v_last_seq
  FROM products
  WHERE internal_code LIKE v_prefix || '%'
    AND LENGTH(internal_code) = LENGTH(v_prefix) + 4; -- 정확한 시퀀스 4자리만

  RETURN v_prefix || LPAD((v_last_seq + 1)::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;


-- ─── 4. 인덱스 ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_products_supplier_code
  ON products (supplier_code);

CREATE INDEX IF NOT EXISTS idx_products_destination_code
  ON products (destination_code);

CREATE INDEX IF NOT EXISTS idx_products_departure_date
  ON products (departure_date);

CREATE INDEX IF NOT EXISTS idx_products_status
  ON products (status);

-- 접두사 LIKE 검색 최적화 (시퀀스 생성 쿼리용)
CREATE INDEX IF NOT EXISTS idx_products_internal_code_prefix
  ON products (internal_code text_pattern_ops);


-- ─── 5. RLS 정책 ─────────────────────────────────────────────

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자(관리자)만 전체 접근
CREATE POLICY "products: authenticated read"
  ON products FOR SELECT TO authenticated USING (true);

CREATE POLICY "products: authenticated insert"
  ON products FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "products: authenticated update"
  ON products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "products: authenticated delete"
  ON products FOR DELETE TO authenticated USING (true);


-- ─── 6. pg_cron: 매일 자정 만료 상품 자동 처리 ───────────────
-- pg_cron 익스텐션이 활성화된 Supabase 프로젝트에서만 실행하세요.
-- (Supabase 대시보드 > Database > Extensions > pg_cron 활성화 필요)

SELECT cron.schedule(
  'expire-products-daily',   -- 크론 잡 이름 (중복 시 오류 — 이미 있다면 아래 unschedule 먼저 실행)
  '0 0 * * *',               -- 매일 UTC 00:00 (한국시간 09:00)
  $$
    UPDATE products
    SET    status     = 'expired',
           updated_at = now()
    WHERE  departure_date < now()
      AND  status NOT IN ('expired', 'cancelled');
  $$
);

-- 기존 잡이 있어 오류가 났을 때 재등록:
-- SELECT cron.unschedule('expire-products-daily');
-- 그리고 위 SELECT cron.schedule(...) 다시 실행
