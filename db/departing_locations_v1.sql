-- ============================================================
-- departing_locations_v1.sql
-- 출발지 마스터 테이블 + bookings FK 컬럼 추가
-- ⚠️ Supabase Dashboard SQL Editor에서 직접 실행 필요
-- ============================================================

-- 1. 출발지 마스터 테이블
CREATE TABLE IF NOT EXISTS departing_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 기본 출발지 삽입 (기존 하드코딩 목록과 동일)
INSERT INTO departing_locations (name) VALUES
  ('부산'), ('인천'), ('청주'), ('대구'), ('무안'), ('기타')
ON CONFLICT (name) DO NOTHING;

-- 3. bookings 테이블에 FK 컬럼 추가
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS departing_location_id UUID
    REFERENCES departing_locations(id) ON DELETE SET NULL;

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_bookings_departing_location_id
  ON bookings(departing_location_id);
