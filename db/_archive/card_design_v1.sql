-- 상품 카드 디자인 개선용 컬럼 추가
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS is_airtel BOOLEAN DEFAULT false;
COMMENT ON COLUMN travel_packages.is_airtel IS '에어텔(항공+호텔) 상품 여부';
