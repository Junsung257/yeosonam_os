-- ============================================================
-- 여소남 OS: Perfect Data Architecture Part 1
-- Migration: 20260401100000
--
-- 신규 테이블:
--   1. booking_segments (PNR 예약 세그먼트)
--   2. customer_unified_profile (360° 고객 프로필 + RFM)
--   3. price_history (가격 히스토리)
--   4. competitor_pricing (경쟁사 가격 비교)
--   5. demand_forecast (수요 예측)
--
-- 함수:
--   calculate_rfm_scores() — RFM 자동 계산
-- ============================================================

BEGIN;

-- ============================================================
-- 1. booking_segments (PNR 세그먼트)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('flight','hotel','transport','activity','meal','guide')),
  sequence_no SMALLINT NOT NULL DEFAULT 1,
  description TEXT,
  supplier TEXT,
  supplier_reference TEXT,
  service_date DATE,
  service_time TEXT,
  duration_minutes INTEGER,
  pax_count INTEGER,

  -- 금액 (INTEGER = 원화)
  cost_price INTEGER DEFAULT 0,
  sell_price INTEGER DEFAULT 0,
  margin INTEGER GENERATED ALWAYS AS (sell_price - cost_price) STORED,
  margin_percent NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN sell_price > 0
      THEN ROUND(((sell_price - cost_price)::NUMERIC / sell_price) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- 상태
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  confirmation_code TEXT,

  -- 세부 정보
  -- flight: {airline, flight_no, dep_airport, arr_airport, class}
  -- hotel: {name, room_type, check_in, check_out, meal_plan}
  -- transport: {vehicle, pickup, dropoff, driver}
  -- activity: {name, location, guide, difficulty}
  details JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (booking_id, segment_type, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_booking_segments_booking ON booking_segments(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_segments_type ON booking_segments(segment_type);
CREATE INDEX IF NOT EXISTS idx_booking_segments_date ON booking_segments(service_date);

-- ============================================================
-- 2. customer_unified_profile (360° 고객 프로필)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_unified_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,

  -- RFM 스코어
  rfm_r SMALLINT DEFAULT 1 CHECK (rfm_r BETWEEN 1 AND 5),
  rfm_f SMALLINT DEFAULT 1 CHECK (rfm_f BETWEEN 1 AND 5),
  rfm_m SMALLINT DEFAULT 1 CHECK (rfm_m BETWEEN 1 AND 5),
  rfm_segment TEXT,
  rfm_calculated_at TIMESTAMPTZ,

  -- Lifetime Value
  ltv_estimate INTEGER DEFAULT 0,
  total_revenue INTEGER DEFAULT 0,
  avg_order_value INTEGER DEFAULT 0,
  first_booking_at TIMESTAMPTZ,
  last_booking_at TIMESTAMPTZ,
  days_since_last_booking INTEGER,
  booking_frequency_days NUMERIC(8,1),

  -- 선호도
  preferred_destinations TEXT[] DEFAULT '{}',
  preferred_styles TEXT[] DEFAULT '{}',
  preferred_budget_range INT4RANGE,
  preferred_travel_months INTEGER[] DEFAULT '{}',
  preferred_party_type TEXT CHECK (preferred_party_type IN ('solo','couple','family','friends','group')),

  -- ML Propensity Scores
  propensity_scores JSONB DEFAULT '{}',
  -- 예: {"book": 0.72, "churn": 0.15, "upgrade": 0.45, "refer": 0.60}

  -- 행동 지표
  website_visit_count INTEGER DEFAULT 0,
  chat_engagement_count INTEGER DEFAULT 0,
  email_open_rate NUMERIC(5,2),
  email_click_rate NUMERIC(5,2),

  -- 세그먼트 & 리스크
  lifecycle_stage TEXT DEFAULT 'prospect'
    CHECK (lifecycle_stage IN ('prospect','first_time','repeat','vip','dormant','churned')),
  churn_risk_level TEXT DEFAULT 'low'
    CHECK (churn_risk_level IN ('low','medium','high','churned')),
  engagement_score SMALLINT DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),

  -- AI 추천
  next_best_action TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cup_customer ON customer_unified_profile(customer_id);
CREATE INDEX IF NOT EXISTS idx_cup_rfm_segment ON customer_unified_profile(rfm_segment) WHERE rfm_segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cup_churn_risk ON customer_unified_profile(churn_risk_level);
CREATE INDEX IF NOT EXISTS idx_cup_lifecycle ON customer_unified_profile(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_cup_engagement ON customer_unified_profile(engagement_score DESC);

-- ============================================================
-- 3. price_history (가격 히스토리)
-- ============================================================
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,

  -- 가격
  price INTEGER NOT NULL,
  cost_price INTEGER DEFAULT 0,
  original_price INTEGER,
  discount_amount INTEGER DEFAULT 0,

  -- 재고
  seats_total INTEGER DEFAULT 0,
  seats_booked INTEGER DEFAULT 0,
  occupancy_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN seats_total > 0
      THEN ROUND((seats_booked::NUMERIC / seats_total) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- 변동 사유
  change_reason TEXT CHECK (change_reason IN ('demand','season','competition','inventory','promotion','manual')),
  change_type TEXT CHECK (change_type IN ('increase','decrease','stable')),

  -- 시장 조건
  demand_level TEXT CHECK (demand_level IN ('very_high','high','normal','low','very_low')),
  season_type TEXT CHECK (season_type IN ('peak','shoulder','low')),
  days_until_departure INTEGER,

  -- 자동화
  is_automated BOOLEAN DEFAULT false,
  pricing_algorithm TEXT,
  source TEXT DEFAULT 'system',

  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_pkg_time ON price_history(package_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_demand ON price_history(demand_level) WHERE demand_level IS NOT NULL;

-- ============================================================
-- 4. competitor_pricing (경쟁사 가격)
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  our_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- 경쟁사
  competitor_name TEXT NOT NULL,
  competitor_product_name TEXT,
  source_url TEXT,

  -- 가격 비교
  competitor_price INTEGER NOT NULL,
  our_price INTEGER NOT NULL,
  price_difference INTEGER GENERATED ALWAYS AS (our_price - competitor_price) STORED,
  price_difference_percent NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN competitor_price > 0
      THEN ROUND(((our_price - competitor_price)::NUMERIC / competitor_price) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- 상품 비교
  destination TEXT,
  duration_days SMALLINT,
  inclusions JSONB,
  quality_score SMALLINT CHECK (quality_score BETWEEN 1 AND 10),

  -- 메타
  scraping_method TEXT DEFAULT 'manual' CHECK (scraping_method IN ('manual','automated','api')),
  data_quality TEXT DEFAULT 'medium' CHECK (data_quality IN ('high','medium','low')),
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_package ON competitor_pricing(our_package_id);
CREATE INDEX IF NOT EXISTS idx_competitor_dest ON competitor_pricing(destination);
CREATE INDEX IF NOT EXISTS idx_competitor_scraped ON competitor_pricing(scraped_at DESC);

-- ============================================================
-- 5. demand_forecast (수요 예측)
-- ============================================================
CREATE TABLE IF NOT EXISTS demand_forecast (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  destination TEXT,

  -- 예측
  forecast_period DATE NOT NULL,
  forecast_demand INTEGER DEFAULT 0,
  actual_demand INTEGER,
  confidence_score NUMERIC(5,4) DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),

  -- 모델
  model_version TEXT,
  prediction_model TEXT CHECK (prediction_model IN ('historical','ml','seasonal','ensemble')),

  -- 영향 요인
  season_factor NUMERIC(5,2),
  trend_factor NUMERIC(5,2),
  event_factor NUMERIC(5,2),
  external_factors JSONB DEFAULT '{}',

  -- 정확도
  forecast_accuracy NUMERIC(5,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_package ON demand_forecast(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demand_dest_period ON demand_forecast(destination, forecast_period);
CREATE INDEX IF NOT EXISTS idx_demand_period ON demand_forecast(forecast_period);

-- ============================================================
-- 6. calculate_rfm_scores() 함수
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_rfm_scores()
RETURNS void AS $$
BEGIN
  -- RFM 원시값 계산 + NTILE 5분위 스코어링 + customer_unified_profile UPSERT
  WITH raw_rfm AS (
    SELECT
      lead_customer_id AS customer_id,
      EXTRACT(DAY FROM NOW() - MAX(created_at))::INTEGER AS recency_days,
      COUNT(*) AS frequency,
      COALESCE(SUM(total_price), 0) AS monetary
    FROM bookings
    WHERE status IN ('deposit_paid', 'waiting_balance', 'fully_paid', 'confirmed', 'completed')
      AND is_deleted = false
      AND lead_customer_id IS NOT NULL
    GROUP BY lead_customer_id
  ),
  scored AS (
    SELECT
      customer_id,
      recency_days,
      frequency,
      monetary,
      -- Recency: 낮을수록 좋음 → 역순 NTILE
      (6 - NTILE(5) OVER (ORDER BY recency_days ASC))::SMALLINT AS r_score,
      NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
      NTILE(5) OVER (ORDER BY monetary ASC) AS m_score,
      -- LTV 관련
      MIN(recency_days) OVER () AS min_recency,
      ROUND(monetary::NUMERIC / NULLIF(frequency, 0)) AS avg_value
    FROM raw_rfm
  ),
  segmented AS (
    SELECT
      s.*,
      CASE
        WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
        WHEN r_score >= 3 AND f_score >= 3 AND m_score >= 3 THEN 'Loyal'
        WHEN r_score >= 4 AND f_score <= 2 THEN 'Promising'
        WHEN r_score >= 3 AND f_score <= 2 AND m_score >= 3 THEN 'Potential Loyalists'
        WHEN r_score <= 2 AND f_score >= 4 AND m_score >= 4 THEN 'Cant Lose Them'
        WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
        WHEN r_score <= 2 AND f_score <= 2 AND m_score <= 2 THEN 'Hibernating'
        WHEN r_score <= 1 THEN 'Lost'
        ELSE 'Need Attention'
      END AS segment,
      CASE
        WHEN r_score <= 1 THEN 'churned'
        WHEN r_score <= 2 AND f_score <= 2 THEN 'high'
        WHEN r_score <= 3 THEN 'medium'
        ELSE 'low'
      END AS churn_risk,
      CASE
        WHEN f_score >= 4 AND m_score >= 4 THEN 'vip'
        WHEN f_score >= 2 THEN 'repeat'
        WHEN f_score = 1 AND r_score >= 3 THEN 'first_time'
        WHEN r_score <= 2 THEN 'dormant'
        ELSE 'prospect'
      END AS lifecycle
    FROM scored s
  )
  INSERT INTO customer_unified_profile (
    customer_id,
    rfm_r, rfm_f, rfm_m, rfm_segment, rfm_calculated_at,
    total_revenue, avg_order_value, days_since_last_booking,
    churn_risk_level, lifecycle_stage
  )
  SELECT
    customer_id,
    r_score, f_score, m_score, segment, NOW(),
    monetary, avg_value, recency_days,
    churn_risk, lifecycle
  FROM segmented
  ON CONFLICT (customer_id) DO UPDATE SET
    rfm_r = EXCLUDED.rfm_r,
    rfm_f = EXCLUDED.rfm_f,
    rfm_m = EXCLUDED.rfm_m,
    rfm_segment = EXCLUDED.rfm_segment,
    rfm_calculated_at = EXCLUDED.rfm_calculated_at,
    total_revenue = EXCLUDED.total_revenue,
    avg_order_value = EXCLUDED.avg_order_value,
    days_since_last_booking = EXCLUDED.days_since_last_booking,
    churn_risk_level = EXCLUDED.churn_risk_level,
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. RLS 정책
-- ============================================================
ALTER TABLE booking_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_unified_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_forecast ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_access" ON booking_segments;
CREATE POLICY "authenticated_access" ON booking_segments FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_access" ON customer_unified_profile;
CREATE POLICY "authenticated_access" ON customer_unified_profile FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_access" ON price_history;
CREATE POLICY "authenticated_access" ON price_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_access" ON competitor_pricing;
CREATE POLICY "authenticated_access" ON competitor_pricing FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_access" ON demand_forecast;
CREATE POLICY "authenticated_access" ON demand_forecast FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 8. updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_segments_updated ON booking_segments;
CREATE TRIGGER trg_booking_segments_updated
  BEFORE UPDATE ON booking_segments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cup_updated ON customer_unified_profile;
CREATE TRIGGER trg_cup_updated
  BEFORE UPDATE ON customer_unified_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- 9. pg_cron 스케줄 (트랜잭션 외부)
-- ============================================================
DO $$
BEGIN
  PERFORM cron.schedule(
    'weekly-rfm-calculation',
    '0 3 * * 0', -- 매주 일요일 03:00 UTC (12:00 KST)
    'SELECT calculate_rfm_scores()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 미활성 — RFM 스케줄 건너뜀. 수동 실행: SELECT calculate_rfm_scores()';
END $$;
