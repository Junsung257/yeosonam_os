-- ============================================================
-- 고객용 공개 예약 페이지 지원 마이그레이션
-- Supabase > SQL Editor 에서 실행하세요. (1회)
-- ============================================================

-- bookings 테이블에 유아 인원 컬럼 추가
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS infant_count INTEGER DEFAULT 0;

-- 확인 쿼리
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name = 'infant_count';
