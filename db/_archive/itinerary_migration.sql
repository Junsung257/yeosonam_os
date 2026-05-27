-- 여소남 OS: 고객용 일정표 데이터 컬럼 추가
-- Supabase SQL Editor에서 실행하세요.

-- travel_packages 테이블에 itinerary_data 컬럼 추가
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS itinerary_data JSONB;

COMMENT ON COLUMN travel_packages.itinerary_data IS
  '고객용 일정표 JSON (TravelItinerary 타입). price_tiers와 합쳐서 A4 이미지 생성. 원가 정보 미포함.';

-- 인덱스: itinerary_data가 채워진 상품 필터링용
CREATE INDEX IF NOT EXISTS idx_packages_has_itinerary
  ON travel_packages ((itinerary_data IS NOT NULL));

-- 확인 쿼리
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'travel_packages'
  AND column_name = 'itinerary_data';
