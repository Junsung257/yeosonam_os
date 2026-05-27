-- ============================================================
-- 3대 광고 통합 데이터 댐 & 통합 수익 연산 스키마
-- Google(gclid) / Meta(fbclid) / Naver(n_keyword)
-- ============================================================
-- Supabase SQL Editor에서 실행: db/ad_tracking_v1.sql 내용을 붙여넣고 Run 클릭

-- ── 1. 세션별 유입 로그 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_traffic_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  user_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  source          TEXT,            -- 'google', 'facebook', 'naver', 'organic', 'direct'
  medium          TEXT,            -- 'cpc', 'social', 'email', 'organic'
  campaign_name   TEXT,            -- utm_campaign
  keyword         TEXT,            -- utm_term (검색 키워드)
  gclid           TEXT,            -- Google Click ID
  fbclid          TEXT,            -- Facebook Click ID
  n_keyword       TEXT,            -- Naver 검색 키워드
  current_cpc     INTEGER,         -- 클릭당 비용 추정값 (원) — 전환 시 allocated_ad_spend로 사용
  consent_agreed  BOOLEAN NOT NULL DEFAULT FALSE,  -- 마케팅 동의 여부 (false → gclid/fbclid NULL 저장)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traffic_session ON ad_traffic_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_traffic_user    ON ad_traffic_logs(user_id)  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffic_gclid   ON ad_traffic_logs(gclid)   WHERE gclid   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffic_fbclid  ON ad_traffic_logs(fbclid)  WHERE fbclid  IS NOT NULL;

-- ── 2. 검색 행동 로그 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_search_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT NOT NULL,
  user_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
  search_query     TEXT,
  search_category  TEXT,           -- 'package', 'hotel', 'activity'
  result_count     INTEGER DEFAULT 0,
  lead_time_days   INTEGER,        -- 앱에서 계산: EXTRACT(DAY FROM departure_date - now())
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_session ON ad_search_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_search_user    ON ad_search_logs(user_id) WHERE user_id IS NOT NULL;

-- ── 3. 행동 참여 로그 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_engagement_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  user_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,  -- 'page_view' | 'product_view' | 'cart_added' | 'checkout_start'
  product_id      TEXT,
  product_name    TEXT,
  cart_added      BOOLEAN NOT NULL DEFAULT FALSE,
  page_url        TEXT,
  lead_time_days  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_session    ON ad_engagement_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_engagement_event_type ON ad_engagement_logs(event_type);

-- ── 4. 전환 통합 테이블 (핵심) ────────────────────────────
-- net_profit: PostgreSQL GENERATED ALWAYS — INSERT 시 포함하지 않아도 자동 계산됨
CREATE TABLE IF NOT EXISTS ad_conversion_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          TEXT NOT NULL,
  user_id             UUID REFERENCES customers(id) ON DELETE SET NULL,
  final_booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  final_sales_price   INTEGER NOT NULL DEFAULT 0,  -- 판매가
  base_cost           INTEGER NOT NULL DEFAULT 0,  -- 원가
  allocated_ad_spend  INTEGER NOT NULL DEFAULT 0,  -- 할당된 광고비 (TrafficLog.current_cpc, 유기면 0)
  net_profit          INTEGER GENERATED ALWAYS AS
                        (final_sales_price - base_cost - allocated_ad_spend) STORED,
  attributed_source   TEXT,   -- 'google' | 'facebook' | 'naver' | 'organic' | 'direct'
  attributed_gclid    TEXT,
  attributed_fbclid   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversion_session    ON ad_conversion_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_conversion_booking    ON ad_conversion_logs(final_booking_id) WHERE final_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversion_attributed ON ad_conversion_logs(attributed_source);
