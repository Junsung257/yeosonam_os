-- ============================================================
-- upload_master_fk_v1.sql
-- products & travel_packages 테이블에 마스터 FK 컬럼 추가
-- PDF 업로드 시 land_operator_id / departing_location_id 자동 매핑용
-- Supabase Dashboard > SQL Editor에서 직접 실행
-- ============================================================

-- ── products 테이블 ───────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS land_operator_id     UUID
    REFERENCES land_operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departing_location_id UUID
    REFERENCES departing_locations(id) ON DELETE SET NULL;

-- ── travel_packages 테이블 ───────────────────────────────────
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS land_operator_id     UUID
    REFERENCES land_operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departing_location_id UUID
    REFERENCES departing_locations(id) ON DELETE SET NULL;
