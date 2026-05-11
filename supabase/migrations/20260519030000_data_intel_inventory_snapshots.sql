-- ============================================================================
-- Data Intelligence Phase 2 — 일일 시계열 스냅샷 (전세기·수요예측의 본체)
-- ============================================================================
-- 목적:
--   - 같은 패키지가 보유→판매로 어떻게 움직이는지 매일 캡쳐
--   - "출발 D-X일에 예약 폭증" 패턴을 학습 가능 데이터로 박제
--   - 시계열 ML 모델(Prophet/Statsmodels) 입력 feature
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_inventory_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   DATE NOT NULL,
  package_id      UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  departure_date  DATE,
  destination     TEXT,
  departing_location_id UUID REFERENCES departing_locations(id) ON DELETE SET NULL,
  seats_total     INTEGER,
  seats_held      INTEGER,
  seats_booked    INTEGER,
  seats_ticketed  INTEGER,
  -- 가격 스냅샷
  current_price   INTEGER,
  cost_price      INTEGER,
  -- 수요 측 신호 (전날 ~ 오늘)
  daily_views     INTEGER NOT NULL DEFAULT 0,
  daily_searches  INTEGER NOT NULL DEFAULT 0,
  daily_qa_mentions INTEGER NOT NULL DEFAULT 0,
  daily_new_bookings INTEGER NOT NULL DEFAULT 0,
  daily_cancellations INTEGER NOT NULL DEFAULT 0,
  -- 보조 통계
  occupancy_rate  NUMERIC(5,2),
  days_to_departure INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, package_id, departure_date)
);

CREATE INDEX IF NOT EXISTS idx_dis_package_date
  ON daily_inventory_snapshots(package_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_dis_destination_date
  ON daily_inventory_snapshots(destination, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_dis_departure
  ON daily_inventory_snapshots(departure_date)
  WHERE departure_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dis_lead_time
  ON daily_inventory_snapshots(days_to_departure)
  WHERE days_to_departure IS NOT NULL;

COMMENT ON TABLE daily_inventory_snapshots IS
  '일일 재고·수요 스냅샷. /api/cron/snapshot-inventory 매일 03:00 KST 실행. 시계열 ML 입력.';

-- ─── booking_pace_aggregate: 출발지×목적지×요일×lead_time bucket 집계 ──────
-- (MV 가 너무 무거우면 일반 테이블 + 일일 cron refresh)
CREATE TABLE IF NOT EXISTS booking_pace_aggregate (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  departing_location_id UUID REFERENCES departing_locations(id) ON DELETE SET NULL,
  destination     TEXT,
  departure_dow   SMALLINT,                  -- 0=일 ~ 6=토
  lead_time_bucket TEXT,                     -- 'D-1', 'D-3', 'D-7', 'D-14', 'D-30', 'D-60+'
  booking_count   INTEGER NOT NULL DEFAULT 0,
  cancel_count    INTEGER NOT NULL DEFAULT 0,
  avg_party_size  NUMERIC(5,2),
  avg_sale_price  NUMERIC(12,2),
  sample_window_start DATE,
  sample_window_end DATE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (departing_location_id, destination, departure_dow, lead_time_bucket, sample_window_start)
);

CREATE INDEX IF NOT EXISTS idx_booking_pace_dest_dow
  ON booking_pace_aggregate(destination, departure_dow);
CREATE INDEX IF NOT EXISTS idx_booking_pace_lead_bucket
  ON booking_pace_aggregate(lead_time_bucket);

COMMENT ON TABLE booking_pace_aggregate IS
  '예약 페이스 집계 (출발지×목적지×요일×리드타임 버킷). /api/cron/refresh-booking-pace 일일 갱신.';
