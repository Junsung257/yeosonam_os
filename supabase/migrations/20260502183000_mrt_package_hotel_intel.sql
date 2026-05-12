-- MRT 숙소 상세 스냅샷 + 패키지 일정 호텔 매칭 (연동 종료 후에도 자비스·점수에 사용)
-- 원칙: 전체 MRT 카탈로그가 아니라, 일정에 등장한 호텔만 조회·저장.

-- Production: MCP applied as mrt_package_hotel_intel (20260502015929). Idempotent IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS mrt_stay_detail_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mrt_gid             TEXT NOT NULL,
  check_in            DATE NOT NULL,
  check_out           DATE NOT NULL,
  adult_count         INT NOT NULL DEFAULT 2,
  child_count         INT NOT NULL DEFAULT 0,
  mrt_name            TEXT,
  rating              NUMERIC(4, 2),
  review_count        INT,
  min_room_price_krw  INT,
  amenities           TEXT[] NOT NULL DEFAULT '{}',
  provider_url        TEXT,
  detail_jsonb        JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mrt_stay_snap_gid_dates_guests
  ON mrt_stay_detail_snapshots (mrt_gid, check_in, check_out, adult_count, child_count);

CREATE INDEX IF NOT EXISTS idx_mrt_stay_snap_expires
  ON mrt_stay_detail_snapshots (expires_at);

COMMENT ON TABLE mrt_stay_detail_snapshots IS
  'MRT getStayDetail 결과 캐시. 패키지 동기화 시 매칭된 gid만 적재. 만료 후 재조회.';

CREATE TABLE IF NOT EXISTS mrt_package_hotel_intel (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id               UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  departure_date           DATE NOT NULL,
  day_index                INT NOT NULL,
  itinerary_hotel_name     TEXT NOT NULL,
  itinerary_hotel_grade    TEXT,
  matched_mrt_gid          TEXT,
  matched_mrt_name        TEXT,
  match_score              NUMERIC(6, 4),
  snapshot_id              UUID REFERENCES mrt_stay_detail_snapshots(id) ON DELETE SET NULL,
  market_median_price_krw  INT,
  listing_price_krw        INT,
  price_percentile         NUMERIC(5, 4),
  composite_mrt_score      NUMERIC(6, 2),
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mrt_pkg_hotel_intel_slot
  ON mrt_package_hotel_intel (package_id, departure_date, day_index);

CREATE INDEX IF NOT EXISTS idx_mrt_pkg_hotel_intel_pkg
  ON mrt_package_hotel_intel (package_id);

CREATE INDEX IF NOT EXISTS idx_mrt_pkg_hotel_intel_computed
  ON mrt_package_hotel_intel (computed_at);

COMMENT ON TABLE mrt_package_hotel_intel IS
  '패키지 일정 호텔 ↔ MRT 매칭 + 당시 시장가 백분위·종합점수. 동기화 API·크론이 갱신.';

ALTER TABLE mrt_stay_detail_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrt_package_hotel_intel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mrt_stay_detail_snapshots_service ON mrt_stay_detail_snapshots;
CREATE POLICY mrt_stay_detail_snapshots_service ON mrt_stay_detail_snapshots
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mrt_package_hotel_intel_service ON mrt_package_hotel_intel;
CREATE POLICY mrt_package_hotel_intel_service ON mrt_package_hotel_intel
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;

NOTIFY pgrst, 'reload schema';
