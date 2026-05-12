-- ============================================================================
-- Data Intelligence Phase 3 — 외부 신호 (항공·OTA·수요예측·정책 발동)
-- ============================================================================
-- 목적:
--   - 항공 좌석 가용성 시계열 (Amadeus / GDS 연동 슬롯)
--   - OTA 가격 비교 스냅샷 (Agoda / Skyscanner 슬롯)
--   - 수요 예측 결과 저장 (Prophet 등 ML 모델 출력)
--   - 정책 엔진 발동 이력 (현재는 정의만 있음 → 실제 발동 로그)
-- 모든 테이블은 "스켈레톤" — 실제 외부 API 연동은 별도 PR에서 채움.
-- ============================================================================

-- ─── flight_availability_snapshots: 항공 좌석 가용성 시계열 ─────────────────
CREATE TABLE IF NOT EXISTS flight_availability_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL,              -- 'amadeus' / 'sabre' / 'duffel' / 'manual'
  origin_iata     TEXT NOT NULL,              -- ICN / PUS / CJU 등
  destination_iata TEXT NOT NULL,             -- DAD / FUK / DLC 등
  departure_date  DATE NOT NULL,
  carrier_code    TEXT,                       -- KE / OZ / VJ 등
  flight_number   TEXT,
  cabin_class     TEXT,                       -- economy / business 등
  available_seats INTEGER,
  lowest_fare_krw INTEGER,
  fare_currency   TEXT DEFAULT 'KRW',
  is_charter_candidate BOOLEAN DEFAULT FALSE,
  raw_payload     JSONB,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_fas_route_date
  ON flight_availability_snapshots(origin_iata, destination_iata, departure_date);
CREATE INDEX IF NOT EXISTS idx_fas_fetched
  ON flight_availability_snapshots(fetched_at DESC);

COMMENT ON TABLE flight_availability_snapshots IS
  '항공 좌석 가용성 일일 스냅샷. /api/cron/sync-flight-availability 일일 실행.';

-- ─── ota_price_snapshots: OTA 가격 비교 스냅샷 ─────────────────────────────
CREATE TABLE IF NOT EXISTS ota_price_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL,              -- 'agoda' / 'skyscanner' / 'klook' / 'mrt'
  product_type    TEXT NOT NULL CHECK (product_type IN ('flight','hotel','activity','package')),
  destination     TEXT,
  origin          TEXT,
  check_in_date   DATE,
  check_out_date  DATE,
  reference_key   TEXT,                       -- 외부 ID (호텔코드/항공편번호 등)
  display_name    TEXT,
  price_krw       INTEGER,
  currency        TEXT DEFAULT 'KRW',
  rating          NUMERIC(3,1),
  review_count    INTEGER,
  raw_payload     JSONB,
  matched_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  price_gap_pct   NUMERIC(6,2),               -- 우리 가격 대비 (+면 우리가 비쌈)
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ota_price_route_date
  ON ota_price_snapshots(source, destination, check_in_date)
  WHERE destination IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ota_price_matched_pkg
  ON ota_price_snapshots(matched_package_id)
  WHERE matched_package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ota_price_fetched
  ON ota_price_snapshots(fetched_at DESC);

COMMENT ON TABLE ota_price_snapshots IS
  '경쟁 OTA 가격 스냅샷. 우리 가격 대비 price_gap_pct 자동 산정. 가격 정책 엔진 입력.';

-- ─── demand_forecast_v2: AI 학습용 수요 예측 결과 ─────────────────────────
-- NOTE: demand_forecast (legacy) 는 기존 ERP 스키마(package_id, forecast_period)로 이미 존재.
--       AI 학습 새 스키마는 _v2 로 분리.
CREATE TABLE IF NOT EXISTS demand_forecast_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_name      TEXT NOT NULL,              -- 'prophet_v1' / 'simple_baseline' / 'gemini_v1'
  model_version   TEXT,
  departing_location_id UUID REFERENCES departing_locations(id) ON DELETE SET NULL,
  destination     TEXT NOT NULL,
  forecast_date   DATE NOT NULL,              -- 예측 대상 출발일
  horizon_days    INTEGER NOT NULL,           -- 며칠 앞 예측
  expected_bookings NUMERIC(8,2),
  expected_revenue_krw NUMERIC(14,2),
  confidence_lower NUMERIC(8,2),
  confidence_upper NUMERIC(8,2),
  feature_snapshot JSONB,                     -- 모델 입력 feature들
  charter_recommendation TEXT,                -- 'recommended' / 'marginal' / 'not_recommended' / 'unknown'
  charter_breakeven_seats INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_demand_forecast_v2_dest_date
  ON demand_forecast_v2(destination, forecast_date);
CREATE INDEX IF NOT EXISTS idx_demand_forecast_v2_generated
  ON demand_forecast_v2(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_demand_forecast_v2_charter
  ON demand_forecast_v2(charter_recommendation)
  WHERE charter_recommendation IS NOT NULL;

COMMENT ON TABLE demand_forecast_v2 IS
  'AI 학습용 수요 예측 결과 (Prophet 등). charter_recommendation 으로 전세기 의사결정 제안.';

-- ─── os_policy_triggers: 정책 엔진 실제 발동 로그 ─────────────────────────
CREATE TABLE IF NOT EXISTS os_policy_triggers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_id       UUID NOT NULL REFERENCES os_policies(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL,              -- 'booking' / 'package' / 'customer' / 'system'
  target_id       UUID,
  trigger_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_taken    TEXT NOT NULL,
  action_result   TEXT NOT NULL CHECK (action_result IN ('success','failure','skipped','noop')),
  error_message   TEXT,
  duration_ms     INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_policy_triggers_policy
  ON os_policy_triggers(policy_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_triggers_target
  ON os_policy_triggers(target_type, target_id)
  WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_policy_triggers_result
  ON os_policy_triggers(action_result, triggered_at DESC);

COMMENT ON TABLE os_policy_triggers IS
  '정책 엔진 실제 발동 이력. 정의(os_policies) 와 발동(os_policy_triggers) 분리.';
