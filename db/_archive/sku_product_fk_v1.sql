-- ============================================================
-- sku_product_fk_v1.sql
-- bookings.product_id → products(internal_code) FK 공식 연결
-- Supabase Dashboard > SQL Editor에서 직접 실행
-- ============================================================

-- product_id 컬럼 추가 (이미 있으면 무시)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS product_id VARCHAR;

-- 기존 FK constraint 정리 후 재등록
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_product_id_fkey;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(internal_code) ON DELETE SET NULL;
