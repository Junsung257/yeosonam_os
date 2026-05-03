-- 관리자 패키지 목록 검색 성능 보강
-- 대상 필드: title, internal_code, short_code, destination, land_operator

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_travel_packages_status_created
  ON travel_packages (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_travel_packages_land_operator
  ON travel_packages (land_operator);

CREATE INDEX IF NOT EXISTS idx_travel_packages_internal_code
  ON travel_packages (internal_code);

CREATE INDEX IF NOT EXISTS idx_travel_packages_short_code
  ON travel_packages (short_code);

CREATE INDEX IF NOT EXISTS idx_travel_packages_title_trgm
  ON travel_packages USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_travel_packages_destination_trgm
  ON travel_packages USING gin (destination gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_travel_packages_land_operator_trgm
  ON travel_packages USING gin (land_operator gin_trgm_ops);

COMMENT ON INDEX idx_travel_packages_status_created IS
  'admin packages list: status + 최신순 정렬 가속';
COMMENT ON INDEX idx_travel_packages_title_trgm IS
  'admin packages list: title ilike 검색 가속';

COMMIT;
