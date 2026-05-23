-- ============================================================
-- 여소남 OS: 멀티터치 어트리뷰션 (MTA) 체인
-- 마이그레이션: 20260524013000
--
-- 목적:
--   1. attribution_touch_events — GA4 / 자체 추적에서 수집한 원시 터치 이벤트 스트림
--   2. attribution_chains — 각 예약(booking)에 대한 전체 터치포인트 체인 (first/last touch 식별)
--   3. attribution_summary — 채널/소재별 MTA 기여도 집계 (5가지 모델)
--
-- 기존:
--   content_roas_summary (first-touch only) → 이 테이블들이 대체
--   affiliate_touchpoints (어필리에이트 전용) → 별도 유지
-- ============================================================

BEGIN;

-- ============================================================
-- 1. attribution_touch_events: 원시 터치 이벤트 스트림
-- ============================================================
CREATE TABLE IF NOT EXISTS attribution_touch_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL, -- 'page_view' | 'blog_read' | 'ad_click' | 'email_open' | 'search'
  channel TEXT NOT NULL,     -- 'naver_blog' | 'google_search' | 'instagram_card' | 'email' | 'direct'
  source TEXT,               -- 'google' | 'naver' | 'meta' | 'direct' | 'email'
  medium TEXT,               -- 'cpc' | 'organic' | 'social' | 'email'
  campaign_id TEXT,
  creative_id UUID REFERENCES content_creatives(id),
  page_url TEXT,
  referrer_url TEXT,
  device_type TEXT,
  cost NUMERIC(12,2) DEFAULT 0,
  touch_timestamp TIMESTAMPTZ DEFAULT now(),
  converted BOOLEAN DEFAULT false,
  booking_id UUID REFERENCES bookings(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. attribution_chains: 각 예약별 전체 터치포인트 체인
-- ============================================================
CREATE TABLE IF NOT EXISTS attribution_chains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  first_visit_at TIMESTAMPTZ,
  conversion_at TIMESTAMPTZ,
  touchpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Array of: { touch_index, channel, source, creative_id, page_url, time_to_conversion_hours, cost, campaign_id }
  first_touch_creative_id UUID REFERENCES content_creatives(id),
  last_touch_creative_id UUID REFERENCES content_creatives(id),
  touch_count INTEGER DEFAULT 0,
  attribution_window_days INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. attribution_summary: 채널/소재별 MTA 기여도 집계
-- ============================================================
CREATE TABLE IF NOT EXISTS attribution_summary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel TEXT NOT NULL, -- 'naver_blog' | 'google_search' | 'instagram_card' | 'email' | 'direct'
  creative_id UUID REFERENCES content_creatives(id),
  campaign_id TEXT,
  first_touch_conversions INTEGER DEFAULT 0,
  last_touch_conversions INTEGER DEFAULT 0,
  linear_conversions NUMERIC(10,4) DEFAULT 0,        -- 1/N 분배
  time_decay_conversions NUMERIC(10,4) DEFAULT 0,     -- 최근 터치 가중
  position_based_conversions NUMERIC(10,4) DEFAULT 0, -- 40% first + 20% middle + 40% last
  total_cost NUMERIC(12,2) DEFAULT 0,
  attributed_revenue NUMERIC(12,2) DEFAULT 0,
  attributed_profit NUMERIC(12,2) DEFAULT 0,
  attribution_window_days INTEGER DEFAULT 30,
  computed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attribution_chains_booking
  ON attribution_chains(booking_id);
CREATE INDEX IF NOT EXISTS idx_attribution_chains_visitor
  ON attribution_chains(visitor_id);
CREATE INDEX IF NOT EXISTS idx_attribution_summary_channel
  ON attribution_summary(channel);
CREATE INDEX IF NOT EXISTS idx_attribution_touch_visitor
  ON attribution_touch_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_attribution_touch_creative
  ON attribution_touch_events(creative_id);
CREATE INDEX IF NOT EXISTS idx_attribution_touch_timestamp
  ON attribution_touch_events(touch_timestamp);
CREATE INDEX IF NOT EXISTS idx_attribution_touch_converted
  ON attribution_touch_events(converted)
  WHERE converted = true;

-- ============================================================
-- Auto-update updated_at trigger for attribution_chains
-- ============================================================
CREATE OR REPLACE FUNCTION update_attribution_chains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attribution_chains_updated_at
  BEFORE UPDATE ON attribution_chains
  FOR EACH ROW
  EXECUTE FUNCTION update_attribution_chains_updated_at();

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE attribution_touch_events IS
  '원시 터치 이벤트 스트림. GA4 / 자체 추적 파이프라인에서 수집, conversion 시점에 booking_id 연결.';
COMMENT ON TABLE attribution_chains IS
  '예약별 전체 터치포인트 체인. closeAttributionChain()이 conversion 시점에 생성.';
COMMENT ON TABLE attribution_summary IS
  '채널/소재별 MTA 기여도 집계 (5개 모델). refreshAttributionSummary()로 주기적 갱신.';

COMMIT;
