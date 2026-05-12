-- ============================================================================
-- Data Intelligence Phase 1 — 비로그인 재방문 식별 (ysm_uid 365일 first-party)
-- ============================================================================
-- 목적: 탭 단위 session_id 외에 365일 first-party 쿠키로 "재방문 식별".
--   - 광고 ROI: 신규방문 vs 재방문 구분
--   - 고객 여정: 첫 검색 → N일 후 예약 패턴
--   - 자연 식별: 로그인 없어도 같은 디바이스/브라우저 행동 추적
-- ============================================================================

ALTER TABLE ad_traffic_logs
  ADD COLUMN IF NOT EXISTS visitor_uid TEXT,
  ADD COLUMN IF NOT EXISTS is_returning BOOLEAN,
  ADD COLUMN IF NOT EXISTS device_type TEXT,           -- mobile/tablet/desktop
  ADD COLUMN IF NOT EXISTS device_os TEXT,             -- iOS/Android/Windows/macOS/Linux/other
  ADD COLUMN IF NOT EXISTS browser_name TEXT,
  ADD COLUMN IF NOT EXISTS viewport_w INTEGER,
  ADD COLUMN IF NOT EXISTS viewport_h INTEGER,
  ADD COLUMN IF NOT EXISTS time_on_page_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_ad_traffic_logs_visitor_uid
  ON ad_traffic_logs(visitor_uid)
  WHERE visitor_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ad_traffic_logs_returning
  ON ad_traffic_logs(is_returning, created_at DESC)
  WHERE is_returning IS NOT NULL;

ALTER TABLE ad_engagement_logs
  ADD COLUMN IF NOT EXISTS visitor_uid TEXT,
  ADD COLUMN IF NOT EXISTS time_on_page_ms INTEGER,    -- 페이지 체류시간
  ADD COLUMN IF NOT EXISTS max_scroll_pct SMALLINT,    -- 최대 스크롤 깊이
  ADD COLUMN IF NOT EXISTS interaction_count SMALLINT; -- 클릭/탭 횟수

CREATE INDEX IF NOT EXISTS idx_ad_engagement_logs_visitor_uid
  ON ad_engagement_logs(visitor_uid)
  WHERE visitor_uid IS NOT NULL;

ALTER TABLE ad_search_logs
  ADD COLUMN IF NOT EXISTS visitor_uid TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_search_logs_visitor_uid
  ON ad_search_logs(visitor_uid)
  WHERE visitor_uid IS NOT NULL;

-- ─── visitor_journey_summary: 재방문 식별 후 누적 여정 ──────────────────────
-- (계산이 무거우면 mv 로 전환 가능 — 일단 테이블)
CREATE TABLE IF NOT EXISTS visitor_journey_summary (
  visitor_uid     TEXT PRIMARY KEY,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  visit_count     INTEGER NOT NULL DEFAULT 1,
  search_count    INTEGER NOT NULL DEFAULT 0,
  product_view_count INTEGER NOT NULL DEFAULT 0,
  chat_open_count INTEGER NOT NULL DEFAULT 0,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  booking_count   INTEGER NOT NULL DEFAULT 0,
  first_source    TEXT,
  last_source     TEXT,
  preferred_destinations TEXT[] DEFAULT '{}',
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_visitor_journey_customer
  ON visitor_journey_summary(customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_journey_last_seen
  ON visitor_journey_summary(last_seen_at DESC);

COMMENT ON TABLE visitor_journey_summary IS
  '비로그인 재방문 누적 통계. ysm_uid 쿠키(365일) 기반. customer_id 연결되면 로그인 후 식별 가능.';
