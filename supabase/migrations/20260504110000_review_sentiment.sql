-- Phase 3-E: 리뷰 감정 분석 테이블
CREATE TABLE IF NOT EXISTS package_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES travel_packages(id),
  booking_id UUID REFERENCES bookings(id),
  customer_id UUID REFERENCES customers(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT,
  -- AI 감정 분석 결과
  sentiment_score INTEGER DEFAULT NULL,        -- 0~100
  sentiment_tags JSONB DEFAULT NULL,           -- {"숙소": 85, "가이드": 90, "일정": 70}
  sentiment_analyzed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_public BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_package_reviews_package_id ON package_reviews(package_id);
CREATE INDEX IF NOT EXISTS idx_package_reviews_booking_id ON package_reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_package_reviews_customer_id ON package_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_package_reviews_sentiment_null ON package_reviews(id) WHERE sentiment_analyzed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_package_reviews_public ON package_reviews(package_id, created_at DESC) WHERE is_public = true;
