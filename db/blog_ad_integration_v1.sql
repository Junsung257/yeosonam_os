-- ============================================================
-- Blog × Ad Integration v1 (2026-04-22)
-- 블로그 ↔ 광고 캠페인 연결 · DKI · UTM 매핑
-- ============================================================

-- 1) content_creatives 확장 (블로그가 광고 랜딩 역할 할 수 있게)
ALTER TABLE content_creatives
  ADD COLUMN IF NOT EXISTS destination         TEXT,
  ADD COLUMN IF NOT EXISTS target_ad_keywords  TEXT[]  DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS landing_headline    TEXT,   -- DKI fallback H1 (키워드 매칭형)
  ADD COLUMN IF NOT EXISTS landing_subtitle    TEXT,   -- hero 아래 셀링 3줄
  ADD COLUMN IF NOT EXISTS landing_enabled     BOOLEAN NOT NULL DEFAULT FALSE; -- 광고 랜딩 모드 on/off

CREATE INDEX IF NOT EXISTS idx_cc_destination ON content_creatives(destination);
CREATE INDEX IF NOT EXISTS idx_cc_landing_enabled ON content_creatives(landing_enabled) WHERE landing_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_cc_target_keywords ON content_creatives USING GIN (target_ad_keywords);

-- 2) ad_creatives 에 블로그 랜딩 FK (선택적 — 기존 slides/blog_html 병행)
ALTER TABLE ad_creatives
  ADD COLUMN IF NOT EXISTS landing_content_creative_id UUID
    REFERENCES content_creatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ac_landing_cc ON ad_creatives(landing_content_creative_id)
  WHERE landing_content_creative_id IS NOT NULL;

-- 3) 광고 × 블로그 × 키워드 매핑 (many-to-many)
--    "이 블로그는 이 캠페인의 이 키워드 그룹 랜딩페이지"
CREATE TABLE IF NOT EXISTS ad_landing_mappings (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id             UUID        REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  content_creative_id     UUID        NOT NULL REFERENCES content_creatives(id) ON DELETE CASCADE,
  platform                TEXT        NOT NULL CHECK (platform IN ('naver','google','meta','kakao')),
  keyword                 TEXT        NOT NULL,                  -- 광고 집행 키워드 (예: "다낭 패키지")
  match_type              TEXT        DEFAULT 'exact'            -- exact / phrase / broad
                                      CHECK (match_type IN ('exact','phrase','broad')),
  utm_source              TEXT        NOT NULL,                  -- naver / google / meta
  utm_medium              TEXT        NOT NULL DEFAULT 'cpc',
  utm_campaign            TEXT        NOT NULL,                  -- 정규화된 캠페인 슬러그
  utm_content             TEXT,                                  -- 광고소재/배리언트
  utm_term                TEXT,                                  -- 검색 키워드 (DKI 대상)
  dki_headline            TEXT,                                  -- 해당 키워드용 동적 H1
  dki_subtitle            TEXT,
  landing_url             TEXT        NOT NULL,                  -- 최종 URL (UTM 포함)
  active                  BOOLEAN     NOT NULL DEFAULT TRUE,
  clicks                  INTEGER     NOT NULL DEFAULT 0,        -- 누적 유입
  conversions             INTEGER     NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, utm_campaign, utm_term, content_creative_id)
);

CREATE INDEX IF NOT EXISTS idx_alm_campaign ON ad_landing_mappings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_alm_content ON ad_landing_mappings(content_creative_id);
CREATE INDEX IF NOT EXISTS idx_alm_platform ON ad_landing_mappings(platform);
CREATE INDEX IF NOT EXISTS idx_alm_active ON ad_landing_mappings(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alm_keyword ON ad_landing_mappings(keyword);

-- 4) traffic_logs 에 매핑 ID 연결 (attribution 정밀화)
ALTER TABLE ad_traffic_logs
  ADD COLUMN IF NOT EXISTS ad_landing_mapping_id UUID REFERENCES ad_landing_mappings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atl_mapping ON ad_traffic_logs(ad_landing_mapping_id)
  WHERE ad_landing_mapping_id IS NOT NULL;

-- 5) updated_at 트리거
CREATE OR REPLACE FUNCTION update_alm_ts()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alm_updated ON ad_landing_mappings;
CREATE TRIGGER trg_alm_updated BEFORE UPDATE ON ad_landing_mappings
  FOR EACH ROW EXECUTE FUNCTION update_alm_ts();

-- 6) 매핑의 clicks/conversions 원자적 증가 RPC
CREATE OR REPLACE FUNCTION increment_alm_clicks(p_mapping_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE ad_landing_mappings SET clicks = clicks + 1 WHERE id = p_mapping_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_alm_conversions(p_mapping_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE ad_landing_mappings SET conversions = conversions + 1 WHERE id = p_mapping_id;
END;
$$ LANGUAGE plpgsql;

-- 7) RLS
ALTER TABLE ad_landing_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_alm" ON ad_landing_mappings;
CREATE POLICY "allow_all_alm" ON ad_landing_mappings FOR ALL USING (true) WITH CHECK (true);
