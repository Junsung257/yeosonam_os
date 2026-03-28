-- ============================================================
-- attractions v3: badge_type 확장 (선택관광/호텔/식사 추가)
-- ============================================================

ALTER TABLE attractions DROP CONSTRAINT IF EXISTS attractions_badge_type_check;
ALTER TABLE attractions ADD CONSTRAINT attractions_badge_type_check
  CHECK (badge_type IN ('tour', 'special', 'shopping', 'meal', 'golf', 'optional', 'hotel', 'restaurant'));
