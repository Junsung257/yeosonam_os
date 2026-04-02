-- ============================================================
-- 여소남 OS: Gemini 확장 필드
-- Migration: 20260401160000
--
-- Gemini 30가지 확장:
--   A. customer_unified_profile: 라이프사이클 7컬럼
--   B. user_actions: 미세 행동 6컬럼
--   C. conversations: AI 감성 분석 5컬럼
--   D. bookings: 재무 확장 6컬럼 (INTEGER 원화 통일)
--   E. post_trip_reviews: 사후 관리 5컬럼
--   F. customer_unified_profile: 7차원 JSONB 5컬럼
--
-- 수정사항 (사용자 SQL 대비):
--   - DECIMAL 금액 → INTEGER (원화)
--   - COMMENT ON 존재하지 않는 컬럼 → 먼저 ADD 후 COMMENT
--   - sentiment_score DECIMAL(3,2) → NUMERIC(4,2) (범위 -1.0~1.0)
-- ============================================================

BEGIN;

-- ============================================================
-- A. customer_unified_profile: 라이프사이클
-- ============================================================
ALTER TABLE customer_unified_profile
  ADD COLUMN IF NOT EXISTS travel_pace_preference TEXT,
  ADD COLUMN IF NOT EXISTS pet_friendly BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS health_needs TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS milestone_dates JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS destination_fatigue TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS travel_companion_profile JSONB DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE customer_unified_profile ADD CONSTRAINT chk_cup_pace
    CHECK (travel_pace_preference IN ('fast_paced','moderate','slow_relaxed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- B. user_actions: 미세 행동
-- ============================================================
ALTER TABLE user_actions
  ADD COLUMN IF NOT EXISTS dwell_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS scroll_depth_percent SMALLINT,
  ADD COLUMN IF NOT EXISTS rage_click_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS copy_to_clipboard_text TEXT,
  ADD COLUMN IF NOT EXISTS mouse_movement_distance_px INTEGER,
  ADD COLUMN IF NOT EXISTS idle_time_seconds INTEGER;

-- ============================================================
-- C. conversations: AI 감성 분석
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sentiment_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS urgency_level TEXT,
  ADD COLUMN IF NOT EXISTS question_complexity SMALLINT,
  ADD COLUMN IF NOT EXISTS ai_intervention_success BOOLEAN,
  ADD COLUMN IF NOT EXISTS rejection_keywords TEXT[] DEFAULT '{}';

DO $$
BEGIN
  ALTER TABLE conversations ADD CONSTRAINT chk_conv_sentiment
    CHECK (sentiment_score BETWEEN -1.0 AND 1.0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD CONSTRAINT chk_conv_urgency
    CHECK (urgency_level IN ('low','medium','high','urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD CONSTRAINT chk_conv_complexity
    CHECK (question_complexity BETWEEN 1 AND 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- D. bookings: 재무 확장 (INTEGER = 원화)
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS installment_months INTEGER,
  ADD COLUMN IF NOT EXISTS discount_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ancillary_spend INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_sensitivity_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS wallet_share_estimate INTEGER;

DO $$
BEGIN
  ALTER TABLE bookings ADD CONSTRAINT chk_bookings_payment_method
    CHECK (payment_method IN ('card','transfer','installment','cash','other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- E. post_trip_reviews: 사후 관리
-- ============================================================
ALTER TABLE post_trip_reviews
  ADD COLUMN IF NOT EXISTS complaint_filed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS complaint_resolution_cost INTEGER,
  ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_risk_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS rebooking_interval_days INTEGER;

-- ============================================================
-- F. customer_unified_profile: Gemini 7차원 JSONB
-- ============================================================
ALTER TABLE customer_unified_profile
  ADD COLUMN IF NOT EXISTS psychological_profile JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_graph JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS behavioral_patterns JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS financial_profile JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS heritage_data JSONB DEFAULT '{}';

-- COMMENT
COMMENT ON COLUMN customer_unified_profile.psychological_profile IS 'Gemini Dim3: 불안도, 과시욕, 즉흥성';
COMMENT ON COLUMN customer_unified_profile.social_graph IS 'Gemini Dim2: 동반자, 의사결정권자, 알파 지수';
COMMENT ON COLUMN customer_unified_profile.behavioral_patterns IS 'Gemini Dim5: 망설임, 체류시간, 클릭 패턴';
COMMENT ON COLUMN customer_unified_profile.financial_profile IS 'Gemini Dim6: 가격민감도, 결제수단, 할부 선호';
COMMENT ON COLUMN customer_unified_profile.heritage_data IS 'Gemini Dim7: 가족 여행 히스토리, 30년 유산';

COMMIT;
