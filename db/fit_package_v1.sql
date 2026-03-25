-- ============================================================
-- FIT/패키지 통합 프로세스 아키텍처 마이그레이션
-- DYNAMIC(자유여행) vs FIXED(패키지) 상품 분리 + 공유 시스템
-- ============================================================

-- ① api_orders에 product_category 컬럼 추가
ALTER TABLE api_orders
  ADD COLUMN IF NOT EXISTS product_category TEXT NOT NULL DEFAULT 'DYNAMIC'
  CHECK (product_category IN ('DYNAMIC','FIXED'));

-- 기존 데이터 마이그레이션: api_name 기반으로 category 추론
UPDATE api_orders
SET product_category = 'FIXED'
WHERE api_name = 'tenant_product';

UPDATE api_orders
SET product_category = 'DYNAMIC'
WHERE api_name IN ('agoda_mock','klook_mock','cruise_mock');

CREATE INDEX IF NOT EXISTS idx_api_orders_category
  ON api_orders(product_category);

-- ② carts.items 내 CartItem도 product_category를 포함할 수 있도록
-- (JSONB 컬럼이므로 별도 ALTER 불필요 — TypeScript 레이어에서 처리)

-- ③ 공유 일정 테이블 (shared_itineraries)
CREATE TABLE IF NOT EXISTS shared_itineraries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code    TEXT NOT NULL UNIQUE,
  share_type    TEXT NOT NULL
    CHECK (share_type IN ('DYNAMIC','FIXED')),

  -- DYNAMIC 전용: 장바구니 스냅샷
  items         JSONB,          -- CartItem[] (가격·수량 포함)
  search_query  TEXT,           -- 원본 검색어 (재조회용)

  -- FIXED 전용: 패키지 상품 정보 + 원작자 후기
  product_id    TEXT,           -- travel_packages.id
  product_name  TEXT,
  review_text   TEXT,           -- 원작자 후기 (최대 1000자)

  -- 공통
  creator_name  TEXT NOT NULL DEFAULT '익명',
  view_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_itineraries_code
  ON shared_itineraries(share_code);

CREATE INDEX IF NOT EXISTS idx_shared_itineraries_expires
  ON shared_itineraries(expires_at);

CREATE INDEX IF NOT EXISTS idx_shared_itineraries_type
  ON shared_itineraries(share_type);

COMMENT ON TABLE shared_itineraries IS
  'DYNAMIC(자유여행): items JSONB 스냅샷 + 오늘의 가격 재조회. FIXED(패키지): product_id + review_text + 달력 날짜 선택.';

COMMENT ON COLUMN shared_itineraries.share_code IS
  '8자 대문자+숫자 랜덤 코드. URL: /share/{share_code}';

COMMENT ON COLUMN shared_itineraries.expires_at IS
  '기본 30일 후 만료. 만료된 링크는 조회 시 404 처리.';
