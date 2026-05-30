-- 여소남 OS — 추천 전환 피드백 루프
-- Phase 2-1: LLM 추천 → 클릭 → 예약 전환율 측정

-- 1. recommendation_events 테이블
CREATE TABLE IF NOT EXISTS recommendation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  recommended_ids UUID[] NOT NULL DEFAULT '{}',  -- LLM이 추천한 상품 ID들
  clicked_id UUID,                                 -- 사용자가 클릭한 상품
  booked_id UUID,                                  -- 실제 예약된 상품
  funnel TEXT[] DEFAULT '{}',                      -- ['recommended', 'clicked', 'booked']
  source TEXT DEFAULT 'concierge',                 -- 'concierge' | 'qa-chat' | 'recommender-api'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_rec_events_session ON recommendation_events(session_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_customer ON recommendation_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_tenant ON recommendation_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rec_events_created ON recommendation_events(created_at DESC);

-- RLS
ALTER TABLE recommendation_events ENABLE ROW LEVEL SECURITY;

-- 자신의 tenant 데이터만 조회
CREATE POLICY rec_events_select ON recommendation_events
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id IN (SELECT id FROM affiliates WHERE id = auth.uid()::uuid)
  );

-- 서비스 롤만 INSERT
CREATE POLICY rec_events_insert ON recommendation_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 2. view: 전환 퍼널 통계
CREATE OR REPLACE VIEW recommendation_conversion_stats AS
SELECT
  tenant_id,
  source,
  COUNT(*) AS total_recommendations,
  COUNT(clicked_id) AS total_clicks,
  COUNT(booked_id) AS total_bookings,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(clicked_id)::numeric / COUNT(*) * 100, 1)
    ELSE 0
  END AS click_rate_pct,
  CASE WHEN COUNT(clicked_id) > 0
    THEN ROUND(COUNT(booked_id)::numeric / COUNT(clicked_id) * 100, 1)
    ELSE 0
  END AS booking_rate_from_click_pct,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(booked_id)::numeric / COUNT(*) * 100, 1)
    ELSE 0
  END AS overall_conversion_pct
FROM recommendation_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY tenant_id, source
ORDER BY overall_conversion_pct DESC;
