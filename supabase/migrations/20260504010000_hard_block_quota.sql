-- 하드블럭 선점 좌석 수 컬럼 추가
-- 미리 선점한 항공/호텔 좌석의 총 쿼터. NULL이면 일반 상품 (소진율 경고 미적용)
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS hard_block_quota INT DEFAULT NULL;

COMMENT ON COLUMN travel_packages.hard_block_quota IS
  '하드블럭 선점 좌석 수. NULL = 일반 상품. 0 초과일 때만 소진율 크론 감지 대상.';

CREATE INDEX IF NOT EXISTS idx_travel_packages_hard_block
  ON travel_packages (hard_block_quota)
  WHERE hard_block_quota IS NOT NULL;
