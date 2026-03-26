-- ============================================================
-- attractions v2: badge_type 컬럼 추가
-- 관광지별 배지를 관리자가 직접 지정 (tour/special/shopping)
-- ============================================================

ALTER TABLE attractions ADD COLUMN IF NOT EXISTS badge_type TEXT DEFAULT 'tour'
  CHECK (badge_type IN ('tour', 'special', 'shopping', 'meal'));

-- 기존 is_special=true인 항목을 special로 마이그레이션
UPDATE attractions SET badge_type = 'special' WHERE is_special = true;
