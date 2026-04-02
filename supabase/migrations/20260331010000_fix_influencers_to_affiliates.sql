-- Phase 1 수정: influencers 제거 + affiliates로 전환
BEGIN;

-- Step 1: customers.referrer_id를 affiliates로 재연결
ALTER TABLE customers DROP COLUMN IF EXISTS referrer_id CASCADE;
ALTER TABLE customers ADD COLUMN referrer_id UUID REFERENCES affiliates(id);
CREATE INDEX IF NOT EXISTS idx_customers_referrer ON customers(referrer_id);

-- Step 2: influencers 테이블 삭제 (미사용 확인됨)
DROP TABLE IF EXISTS influencers CASCADE;

-- Step 3: travel_packages에 추적 컬럼 추가
ALTER TABLE travel_packages
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS inquiry_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_packages_destination ON travel_packages(destination);

-- Step 4: 잘못된 인덱스 제거
DROP INDEX IF EXISTS idx_products_destination;

COMMIT;
