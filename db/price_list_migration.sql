-- 여소남 OS: price_list 컬럼 추가 마이그레이션
-- Supabase SQL Editor에서 실행하세요.
-- 기존 price_tiers 컬럼 유지 (하위 호환) — price_list는 additive 추가

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS price_list JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN travel_packages.price_list IS
  'AI 구조화 가격표 (PriceListItem[] 타입). price_tiers 병행 유지(하위 호환).
   예: [{"period":"3/20~3/28","rules":[{"condition":"수요일","price_text":"799,000원","price":799000,"badge":"특가♥"}],"notes":"싱글차지 8만원/인"}]';

-- price_list가 비어있지 않은 레코드 필터링 인덱스
CREATE INDEX IF NOT EXISTS idx_packages_price_list_exists
  ON travel_packages ((price_list IS NOT NULL AND jsonb_array_length(price_list) > 0));

-- 확인 쿼리
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'travel_packages'
  AND column_name = 'price_list';
