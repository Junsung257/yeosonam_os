-- ============================================================
-- attractions v4: long_desc 컬럼 추가
-- 모바일 랜딩 페이지에서 관광지 상세 설명 표시용
-- ============================================================

ALTER TABLE attractions ADD COLUMN IF NOT EXISTS long_desc TEXT;
