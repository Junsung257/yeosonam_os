-- ============================================================
-- 여소남 OS: Perfect Data Architecture Part 2
-- Migration: 20260401110000
--
-- 신규 테이블:
--   PART 4: pre_trip_data, during_trip_feedback, post_trip_reviews, customer_preferences_learned
--   PART 5: search_sessions_detailed, product_comparison_events
--   PART 6: suppliers, supplier_inventory, supplier_performance
--   PART 7: marketing_campaigns, campaign_engagements
--   PART 8: block_purchase_plans, automated_settlements, daily_operations_metrics
--
-- 트리거: booking→profile 자동 업데이트, 가격 변경 히스토리
-- 뷰: high_value_customers, at_risk_customers, product_performance_dashboard
--
-- 수정사항 (사용자 SQL 대비):
--   1. bookings.customer_id → lead_customer_id
--   2. customer_unified_profile 컬럼명 정합성 (ltv_estimate, total_revenue 등)
--   3. DECIMAL → INTEGER (원화 금액)
--   4. price_history 트리거 컬럼 정합성
--   5. 뷰: travel_packages.duration_nights → nights, status 필터 수정
--   6. propensity_to_book/churn → propensity_scores JSONB
--   7. 모든 테이블 RLS + updated_at 트리거
-- ============================================================

BEGIN;

-- ============================================================
-- PART 4: 여행 경험 데이터
-- ============================================================

-- 4-1. 여행 전 기대/준비
CREATE TABLE IF NOT EXISTS pre_trip_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 기대사항
  expectations TEXT[],
  must_do_activities TEXT[],
  concerns TEXT[],
  special_requests TEXT[],

  -- 준비 상태
  documents_ready BOOLEAN DEFAULT false,
  insurance_purchased BOOLEAN DEFAULT false,
  vaccinations_completed BOOLEAN DEFAULT false,
  packing_completed BOOLEAN DEFAULT false,

  -- 커뮤니케이션
  preferred_contact_method TEXT CHECK (preferred_contact_method IN ('email','sms','kakao','call')),
  contact_time_preference TEXT,
  language_preference TEXT DEFAULT 'ko',

  -- 설문
  survey_responses JSONB DEFAULT '{}',
  excitement_level SMALLINT CHECK (excitement_level BETWEEN 1 AND 10),

  collected_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pretrip_booking ON pre_trip_data(booking_id);
CREATE INDEX IF NOT EXISTS idx_pretrip_customer ON pre_trip_data(customer_id);

-- 4-2. 여행 중 피드백
CREATE TABLE IF NOT EXISTS during_trip_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 체크인
  check_in_date DATE,
  check_in_method TEXT CHECK (check_in_method IN ('app','sms','call','in_person')),

  -- 실시간 피드백
  current_satisfaction SMALLINT CHECK (current_satisfaction BETWEEN 1 AND 10),
  issues_reported TEXT[],
  issue_severity TEXT CHECK (issue_severity IN ('critical','high','medium','low')),
  issue_resolved BOOLEAN DEFAULT false,
  resolution_time_minutes INTEGER,

  -- 서비스 평가 (1-5)
  guide_rating SMALLINT CHECK (guide_rating BETWEEN 1 AND 5),
  hotel_rating SMALLINT CHECK (hotel_rating BETWEEN 1 AND 5),
  food_rating SMALLINT CHECK (food_rating BETWEEN 1 AND 5),
  transport_rating SMALLINT CHECK (transport_rating BETWEEN 1 AND 5),

  -- 추가 요청
  additional_requests TEXT[],
  upgrade_interest BOOLEAN DEFAULT false,

  -- 위치
  current_location TEXT,

  -- 메타
  feedback_channel TEXT CHECK (feedback_channel IN ('app','sms','call','guide')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duringtrip_booking ON during_trip_feedback(booking_id);
CREATE INDEX IF NOT EXISTS idx_duringtrip_date ON during_trip_feedback(created_at);

-- 4-3. 여행 후 리뷰
CREATE TABLE IF NOT EXISTS post_trip_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- 전체 평가
  overall_rating SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  would_recommend BOOLEAN,
  would_book_again BOOLEAN,

  -- 세부 평가 (1-5)
  value_for_money SMALLINT CHECK (value_for_money BETWEEN 1 AND 5),
  itinerary_quality SMALLINT CHECK (itinerary_quality BETWEEN 1 AND 5),
  guide_quality SMALLINT CHECK (guide_quality BETWEEN 1 AND 5),
  accommodation_quality SMALLINT CHECK (accommodation_quality BETWEEN 1 AND 5),
  food_quality SMALLINT CHECK (food_quality BETWEEN 1 AND 5),
  transportation_quality SMALLINT CHECK (transportation_quality BETWEEN 1 AND 5),

  -- 텍스트 리뷰
  title TEXT,
  review_text TEXT,
  pros TEXT[],
  cons TEXT[],
  tips_for_travelers TEXT[],

  -- 미디어
  photo_urls TEXT[],
  video_urls TEXT[],

  -- 메타
  review_language TEXT DEFAULT 'ko',
  verified_traveler BOOLEAN DEFAULT true,
  helpful_count INTEGER DEFAULT 0,

  -- 상태
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','flagged')),
  moderation_notes TEXT,
  is_featured BOOLEAN DEFAULT false,

  -- 여소남 응답
  company_response TEXT,
  company_responded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_booking ON post_trip_reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_review_package ON post_trip_reviews(package_id);
CREATE INDEX IF NOT EXISTS idx_review_rating ON post_trip_reviews(overall_rating);
CREATE INDEX IF NOT EXISTS idx_review_status ON post_trip_reviews(status);
CREATE INDEX IF NOT EXISTS idx_review_featured ON post_trip_reviews(is_featured) WHERE is_featured = true;

-- 4-4. 고객 선호도 학습
CREATE TABLE IF NOT EXISTS customer_preferences_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,

  -- 자동 학습 선호도
  preferred_meal_types TEXT[] DEFAULT '{}',
  preferred_activities TEXT[] DEFAULT '{}',
  preferred_accommodation_style TEXT[] DEFAULT '{}',
  preferred_pace TEXT CHECK (preferred_pace IN ('relaxed','moderate','packed')),

  -- 회피
  dislikes TEXT[] DEFAULT '{}',
  allergies TEXT[] DEFAULT '{}',
  accessibility_needs TEXT[] DEFAULT '{}',

  -- 예산 패턴
  typical_budget_range INT4RANGE,
  price_sensitivity TEXT CHECK (price_sensitivity IN ('high','medium','low')),
  upgrade_propensity NUMERIC(3,2) CHECK (upgrade_propensity BETWEEN 0 AND 1),

  -- 예약 행동
  typical_lead_time_days INTEGER,
  preferred_booking_dow SMALLINT CHECK (preferred_booking_dow BETWEEN 0 AND 6),
  preferred_booking_hour SMALLINT CHECK (preferred_booking_hour BETWEEN 0 AND 23),
  decision_speed TEXT CHECK (decision_speed IN ('impulsive','quick','deliberate','slow')),

  -- 소셜
  shares_on_social BOOLEAN DEFAULT false,
  writes_reviews BOOLEAN DEFAULT false,
  refers_friends BOOLEAN DEFAULT false,

  -- 학습 메타
  confidence_score NUMERIC(3,2) DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),
  data_points_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preferences_customer ON customer_preferences_learned(customer_id);

-- ============================================================
-- PART 5: 고급 검색/탐색 추적
-- ============================================================

-- 5-1. 검색 세션 상세
CREATE TABLE IF NOT EXISTS search_sessions_detailed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 세션
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- 검색 행동
  total_searches INTEGER DEFAULT 0,
  search_queries TEXT[] DEFAULT '{}',
  destinations_searched TEXT[] DEFAULT '{}',

  -- 필터
  filters_used JSONB DEFAULT '{}',
  filter_change_count INTEGER DEFAULT 0,

  -- 상품 인터랙션
  products_viewed UUID[] DEFAULT '{}',
  products_compared UUID[] DEFAULT '{}',
  products_favorited UUID[] DEFAULT '{}',
  time_per_product JSONB DEFAULT '{}',

  -- 페이지 흐름
  page_sequence TEXT[] DEFAULT '{}',
  entry_page TEXT,
  exit_page TEXT,

  -- 디바이스
  device_type TEXT CHECK (device_type IN ('mobile','tablet','desktop')),
  browser TEXT,
  os TEXT,

  -- 전환
  converted BOOLEAN DEFAULT false,
  conversion_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  conversion_value INTEGER,
  time_to_conversion_seconds INTEGER,

  -- 이탈
  abandoned BOOLEAN DEFAULT false,
  abandonment_stage TEXT,

  -- 참여도
  engagement_score NUMERIC(5,1) DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,

  -- UTM
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_session ON search_sessions_detailed(session_id);
CREATE INDEX IF NOT EXISTS idx_search_customer ON search_sessions_detailed(customer_id);
CREATE INDEX IF NOT EXISTS idx_search_converted ON search_sessions_detailed(converted) WHERE converted = true;
CREATE INDEX IF NOT EXISTS idx_search_started ON search_sessions_detailed(started_at DESC);

-- 5-2. 상품 비교 이벤트
CREATE TABLE IF NOT EXISTS product_comparison_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  product_a_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  product_b_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  product_c_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  comparison_criteria TEXT[] DEFAULT '{}',
  time_spent_seconds INTEGER,
  selected_product_id UUID,
  selection_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparison_session ON product_comparison_events(session_id);

-- ============================================================
-- PART 6: 공급사/파트너 관리
-- ============================================================

-- 6-1. 공급사
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hotel','airline','dmc','transport','restaurant','activity','other')),
  category TEXT,

  -- 연락처
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  website TEXT,

  -- 계약
  contract_start_date DATE,
  contract_end_date DATE,
  contract_terms JSONB DEFAULT '{}',
  payment_terms TEXT CHECK (payment_terms IN ('prepaid','net_30','net_60','net_90')),
  commission_rate NUMERIC(5,2),

  -- 성과
  reliability_score NUMERIC(3,1) CHECK (reliability_score BETWEEN 0 AND 10),
  quality_score NUMERIC(3,1) CHECK (quality_score BETWEEN 0 AND 10),
  response_time_hours NUMERIC(6,1),

  -- 재무 (INTEGER = 원화)
  total_transactions INTEGER DEFAULT 0,
  total_volume INTEGER DEFAULT 0,
  outstanding_balance INTEGER DEFAULT 0,

  -- 상태
  status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  preferred_supplier BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_transaction_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(type);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_preferred ON suppliers(preferred_supplier) WHERE preferred_supplier = true;

-- 6-2. 공급사 재고
CREATE TABLE IF NOT EXISTS supplier_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  supplier_product_code TEXT,
  product_name TEXT,
  product_type TEXT,
  destination TEXT,

  -- 날짜/재고
  service_date DATE,
  available_quantity INTEGER,
  total_quantity INTEGER,
  minimum_quantity INTEGER DEFAULT 0,

  -- 가격 (INTEGER = 원화)
  cost_price INTEGER,
  retail_price INTEGER,
  rack_rate INTEGER,

  -- 조건
  booking_deadline TIMESTAMPTZ,
  cancellation_policy TEXT,

  is_available BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_supplier ON supplier_inventory(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_date ON supplier_inventory(service_date);
CREATE INDEX IF NOT EXISTS idx_inventory_available ON supplier_inventory(is_available) WHERE is_available = true;

-- 6-3. 공급사 성과
CREATE TABLE IF NOT EXISTS supplier_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- KPI
  total_bookings INTEGER DEFAULT 0,
  confirmed_bookings INTEGER DEFAULT 0,
  cancelled_bookings INTEGER DEFAULT 0,
  confirmed_rate NUMERIC(5,2),

  -- 품질
  average_rating NUMERIC(3,1),
  complaint_count INTEGER DEFAULT 0,
  compliment_count INTEGER DEFAULT 0,

  -- 재무 (INTEGER)
  total_revenue INTEGER DEFAULT 0,
  total_cost INTEGER DEFAULT 0,
  gross_margin INTEGER DEFAULT 0,

  -- 효율성
  avg_response_time_hours NUMERIC(6,1),
  on_time_delivery_rate NUMERIC(5,2),
  accuracy_rate NUMERIC(5,2),

  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_supplier ON supplier_performance(supplier_id);
CREATE INDEX IF NOT EXISTS idx_perf_period ON supplier_performance(period_start, period_end);

-- ============================================================
-- PART 7: 마케팅 & 캠페인
-- ============================================================

-- 7-1. 마케팅 캠페인 (기존 ad_campaigns와 별개: 전체 마케팅 계획)
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('email','sms','social','display','retargeting','content','offline')),
  channels TEXT[] DEFAULT '{}',

  -- 타겟팅
  target_segments TEXT[] DEFAULT '{}',
  target_criteria JSONB DEFAULT '{}',
  estimated_audience_size INTEGER,

  -- 일정
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','cancelled')),

  -- 예산 (INTEGER = 원화)
  budget INTEGER DEFAULT 0,
  spent INTEGER DEFAULT 0,
  remaining INTEGER GENERATED ALWAYS AS (budget - spent) STORED,

  -- 목표
  goal TEXT CHECK (goal IN ('awareness','consideration','conversion','retention')),
  target_conversions INTEGER,
  target_revenue INTEGER,

  -- 성과
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue INTEGER DEFAULT 0,

  -- GENERATED 메트릭
  ctr NUMERIC(6,3) GENERATED ALWAYS AS (
    CASE WHEN impressions > 0 THEN ROUND((clicks::NUMERIC / impressions) * 100, 3) ELSE 0 END
  ) STORED,
  cpc INTEGER GENERATED ALWAYS AS (
    CASE WHEN clicks > 0 THEN ROUND(spent::NUMERIC / clicks) ELSE 0 END
  ) STORED,
  cpa INTEGER GENERATED ALWAYS AS (
    CASE WHEN conversions > 0 THEN ROUND(spent::NUMERIC / conversions) ELSE 0 END
  ) STORED,
  roas NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN spent > 0 THEN ROUND(revenue::NUMERIC / spent, 2) ELSE 0 END
  ) STORED,

  -- 크리에이티브
  creative_variants JSONB DEFAULT '{}',
  winning_variant TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mktg_dates ON marketing_campaigns(start_date, end_date);

-- 7-2. 캠페인 참여
CREATE TABLE IF NOT EXISTS campaign_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 노출
  shown_at TIMESTAMPTZ,
  creative_variant TEXT,

  -- 인터랙션
  clicked BOOLEAN DEFAULT false,
  clicked_at TIMESTAMPTZ,

  -- 전환
  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  conversion_value INTEGER,

  -- 어트리뷰션
  attribution_model TEXT CHECK (attribution_model IN ('first_touch','last_touch','linear','time_decay')),
  attribution_weight NUMERIC(3,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engage_campaign ON campaign_engagements(campaign_id);
CREATE INDEX IF NOT EXISTS idx_engage_customer ON campaign_engagements(customer_id);
CREATE INDEX IF NOT EXISTS idx_engage_converted ON campaign_engagements(converted) WHERE converted = true;

-- ============================================================
-- PART 8: 운영 최적화
-- ============================================================

-- 8-1. 블록 구매 계획
CREATE TABLE IF NOT EXISTS block_purchase_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  destination TEXT NOT NULL,
  duration_nights INTEGER,
  season TEXT CHECK (season IN ('peak','shoulder','low')),

  -- 수량
  planned_quantity INTEGER DEFAULT 0,
  purchased_quantity INTEGER DEFAULT 0,
  sold_quantity INTEGER DEFAULT 0,
  remaining_quantity INTEGER GENERATED ALWAYS AS (purchased_quantity - sold_quantity) STORED,

  -- 가격 (INTEGER = 원화)
  purchase_cost_per_unit INTEGER,
  target_sell_price INTEGER,
  target_margin_percent NUMERIC(5,2),

  -- 예측
  predicted_demand INTEGER,
  confidence_level NUMERIC(3,2) CHECK (confidence_level BETWEEN 0 AND 1),
  prediction_model TEXT,

  -- 리스크
  risk_level TEXT CHECK (risk_level IN ('low','medium','high')),
  risk_factors TEXT[] DEFAULT '{}',
  hedge_strategy TEXT,

  -- 타이밍
  purchase_deadline DATE,
  sale_start_date DATE,
  sale_end_date DATE,
  departure_date_range DATERANGE,

  -- 실적
  actual_demand INTEGER,
  forecast_accuracy NUMERIC(5,2),
  actual_margin_percent NUMERIC(5,2),
  roi NUMERIC(6,2),

  -- 상태
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned','approved','purchased','selling','completed','cancelled')),

  -- 승인
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_block_dest ON block_purchase_plans(destination);
CREATE INDEX IF NOT EXISTS idx_block_status ON block_purchase_plans(status);

-- 8-2. 정산 자동화 (기존 settlements = 제휴사 정산, 이것은 전체 파트너 정산)
CREATE TABLE IF NOT EXISTS automated_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  settlement_period_start DATE NOT NULL,
  settlement_period_end DATE NOT NULL,

  partner_type TEXT NOT NULL CHECK (partner_type IN ('affiliate','supplier','agent','land_operator')),
  partner_id UUID,

  -- 금액 (INTEGER = 원화)
  total_transactions INTEGER DEFAULT 0,
  gross_amount INTEGER DEFAULT 0,
  commission_amount INTEGER DEFAULT 0,
  tax_amount INTEGER DEFAULT 0,
  net_amount INTEGER DEFAULT 0,

  -- 상태
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','disputed')),

  -- 지불
  payment_method TEXT,
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,

  -- 메타
  generated_at TIMESTAMPTZ DEFAULT now(),
  generated_by TEXT DEFAULT 'system',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  invoice_url TEXT,
  receipt_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_auto_settle_partner ON automated_settlements(partner_type, partner_id);
CREATE INDEX IF NOT EXISTS idx_auto_settle_status ON automated_settlements(status);
CREATE INDEX IF NOT EXISTS idx_auto_settle_period ON automated_settlements(settlement_period_start, settlement_period_end);

-- 8-3. 일별 운영 메트릭
CREATE TABLE IF NOT EXISTS daily_operations_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE UNIQUE NOT NULL,

  -- 예약
  new_bookings INTEGER DEFAULT 0,
  cancelled_bookings INTEGER DEFAULT 0,
  confirmed_bookings INTEGER DEFAULT 0,

  -- 재무 (INTEGER)
  daily_revenue INTEGER DEFAULT 0,
  daily_cost INTEGER DEFAULT 0,
  daily_margin INTEGER DEFAULT 0,

  -- 고객
  new_customers INTEGER DEFAULT 0,
  returning_customers INTEGER DEFAULT 0,

  -- 트래픽
  website_visitors INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,

  -- 전환
  conversion_rate NUMERIC(5,2),
  avg_booking_value INTEGER,

  -- 재고
  total_available_seats INTEGER,
  seats_sold INTEGER,
  occupancy_rate NUMERIC(5,2),

  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_date ON daily_operations_metrics(metric_date DESC);

-- ============================================================
-- RLS 정책 (14개 테이블)
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pre_trip_data', 'during_trip_feedback', 'post_trip_reviews', 'customer_preferences_learned',
    'search_sessions_detailed', 'product_comparison_events',
    'suppliers', 'supplier_inventory', 'supplier_performance',
    'marketing_campaigns', 'campaign_engagements',
    'block_purchase_plans', 'automated_settlements', 'daily_operations_metrics'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_access" ON %I', tbl);
    EXECUTE format('CREATE POLICY "authenticated_access" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- ============================================================
-- updated_at 자동 트리거
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
  trg_name TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'suppliers', 'supplier_inventory', 'marketing_campaigns', 'customer_preferences_learned'
  ] LOOP
    trg_name := 'trg_' || tbl || '_updated';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg_name, tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', trg_name, tbl);
  END LOOP;
END $$;

-- ============================================================
-- 트리거: 예약 생성 시 고객 프로필 자동 업데이트
-- ============================================================
-- 수정: NEW.customer_id → NEW.lead_customer_id
--       컬럼명 customer_unified_profile 실제 스키마에 맞춤

CREATE OR REPLACE FUNCTION update_customer_profile_on_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO customer_unified_profile (
    customer_id,
    total_revenue,
    avg_order_value,
    first_booking_at,
    last_booking_at,
    days_since_last_booking
  )
  VALUES (
    NEW.lead_customer_id,
    COALESCE(NEW.total_price, 0),
    COALESCE(NEW.total_price, 0),
    NOW(),
    NOW(),
    0
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    total_revenue = customer_unified_profile.total_revenue + COALESCE(NEW.total_price, 0),
    last_booking_at = NOW(),
    days_since_last_booking = 0,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_booking_update_profile ON bookings;
CREATE TRIGGER trg_booking_update_profile
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_profile_on_booking();

-- ============================================================
-- 트리거: 가격 변경 시 히스토리 자동 저장
-- ============================================================
-- 수정: price_history 실제 컬럼명에 맞춤 (Part 1 스키마)

CREATE OR REPLACE FUNCTION track_price_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO price_history (
      package_id,
      price,
      cost_price,
      original_price,
      change_type,
      change_reason,
      seats_total,
      seats_booked,
      source
    ) VALUES (
      NEW.id,
      NEW.price,
      COALESCE(NEW.cost_price, 0),
      OLD.price,
      CASE WHEN NEW.price > OLD.price THEN 'increase' ELSE 'decrease' END,
      'manual',
      COALESCE(NEW.seats_held, 0),
      COALESCE(NEW.seats_confirmed, 0),
      'trigger'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_package_price_history ON travel_packages;
CREATE TRIGGER trg_package_price_history
  AFTER UPDATE ON travel_packages
  FOR EACH ROW
  EXECUTE FUNCTION track_price_changes();

-- ============================================================
-- 뷰: 고가치 고객
-- ============================================================
-- 수정: customer_unified_profile 실제 컬럼명 사용

CREATE OR REPLACE VIEW high_value_customers AS
SELECT
  c.id,
  c.name,
  c.email,
  c.phone,
  p.total_revenue,
  p.avg_order_value,
  p.ltv_estimate,
  p.rfm_r, p.rfm_f, p.rfm_m,
  p.rfm_segment,
  p.lifecycle_stage,
  p.engagement_score,
  p.next_best_action
FROM customers c
JOIN customer_unified_profile p ON c.id = p.customer_id
WHERE p.ltv_estimate > 5000000
   OR p.rfm_segment IN ('Champions', 'Loyal', 'Cant Lose Them')
ORDER BY p.ltv_estimate DESC NULLS LAST;

-- ============================================================
-- 뷰: 이탈 위험 고객
-- ============================================================

CREATE OR REPLACE VIEW at_risk_customers AS
SELECT
  c.id,
  c.name,
  c.email,
  c.phone,
  p.days_since_last_booking,
  p.total_revenue,
  p.rfm_r, p.rfm_f, p.rfm_m,
  p.rfm_segment,
  p.churn_risk_level,
  p.propensity_scores->>'churn' AS churn_propensity
FROM customers c
JOIN customer_unified_profile p ON c.id = p.customer_id
WHERE p.rfm_segment IN ('At Risk', 'Cant Lose Them', 'Hibernating', 'Lost')
   OR p.churn_risk_level IN ('high', 'churned')
ORDER BY p.churn_risk_level DESC, p.total_revenue DESC NULLS LAST;

-- ============================================================
-- 뷰: 상품 성과 대시보드
-- ============================================================
-- 수정: duration_nights → nights, status 필터 수정

CREATE OR REPLACE VIEW product_performance_dashboard AS
SELECT
  tp.id,
  tp.title,
  tp.destination,
  tp.nights,
  tp.duration,
  tp.price,
  tp.status,
  tp.view_count,
  tp.inquiry_count,
  COUNT(DISTINCT b.id) AS booking_count,
  COALESCE(AVG(r.overall_rating), 0) AS avg_rating,
  COALESCE(SUM(b.total_price), 0) AS total_revenue,
  CASE WHEN tp.view_count > 0
    THEN ROUND((tp.inquiry_count::NUMERIC / tp.view_count) * 100, 1)
    ELSE 0
  END AS inquiry_rate,
  CASE WHEN tp.inquiry_count > 0
    THEN ROUND((COUNT(DISTINCT b.id)::NUMERIC / tp.inquiry_count) * 100, 1)
    ELSE 0
  END AS conversion_rate
FROM travel_packages tp
LEFT JOIN bookings b ON b.package_id = tp.id
  AND b.status IN ('deposit_paid', 'waiting_balance', 'fully_paid', 'confirmed', 'completed')
  AND b.is_deleted = false
LEFT JOIN post_trip_reviews r ON r.package_id = tp.id AND r.status = 'approved'
GROUP BY tp.id, tp.title, tp.destination, tp.nights, tp.duration,
         tp.price, tp.status, tp.view_count, tp.inquiry_count;

COMMIT;
