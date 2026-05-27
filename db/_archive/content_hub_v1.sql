-- ============================================================
-- Content Hub: 콘텐츠 생성 + 성과 추적 + 학습 인사이트
-- SaaS 확장 대비 tenant_id 포함 (현재는 필터 미적용)
-- ============================================================

-- 1. 광고 소재 (핵심 테이블)
CREATE TABLE IF NOT EXISTS content_creatives (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID,
  product_id      UUID        REFERENCES travel_packages(id) ON DELETE SET NULL,
  angle_type      TEXT        NOT NULL DEFAULT 'emotional'
    CHECK (angle_type IN ('value','emotional','filial','luxury','urgency','activity','food')),
  target_audience TEXT,
  channel         TEXT        NOT NULL DEFAULT 'instagram_card'
    CHECK (channel IN ('instagram_card','instagram_reel','naver_blog','google_search','youtube_short','kakao')),
  image_ratio     TEXT        DEFAULT '1:1' CHECK (image_ratio IN ('1:1','4:5','9:16','16:9')),
  slides          JSONB       DEFAULT '[]'::jsonb,
  blog_html       TEXT,
  ad_copy         JSONB,
  tracking_id     TEXT        UNIQUE,
  tone            TEXT        DEFAULT 'professional',
  extra_prompt    TEXT,
  status          TEXT        DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_product ON content_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_cc_angle ON content_creatives(angle_type);
CREATE INDEX IF NOT EXISTS idx_cc_channel ON content_creatives(channel);
CREATE INDEX IF NOT EXISTS idx_cc_status ON content_creatives(status);
CREATE INDEX IF NOT EXISTS idx_cc_tracking ON content_creatives(tracking_id);

-- 2. 성과 (일별 스냅샷)
CREATE TABLE IF NOT EXISTS content_performance (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  creative_id     UUID        REFERENCES content_creatives(id) ON DELETE CASCADE,
  tenant_id       UUID,
  date            DATE        NOT NULL,
  impressions     INTEGER     DEFAULT 0,
  clicks          INTEGER     DEFAULT 0,
  ctr             NUMERIC(6,2) DEFAULT 0,
  conversions     INTEGER     DEFAULT 0,
  spend           INTEGER     DEFAULT 0,
  cpa             INTEGER     DEFAULT 0,
  roas            NUMERIC(8,2) DEFAULT 0,
  platform_raw    JSONB       DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creative_id, date)
);

CREATE INDEX IF NOT EXISTS idx_cp_creative ON content_performance(creative_id);
CREATE INDEX IF NOT EXISTS idx_cp_date ON content_performance(date);

-- 3. 학습 인사이트 (자동 집계)
CREATE TABLE IF NOT EXISTS content_insights (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID,
  destination     TEXT        NOT NULL,
  angle_type      TEXT        NOT NULL,
  channel         TEXT        NOT NULL,
  target_audience TEXT,
  avg_ctr         NUMERIC(6,2) DEFAULT 0,
  avg_conversions NUMERIC(8,2) DEFAULT 0,
  avg_cpa         NUMERIC(10,2) DEFAULT 0,
  sample_count    INTEGER     DEFAULT 0,
  confidence_score NUMERIC(4,2) DEFAULT 0,
  last_updated    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_unique
  ON content_insights(destination, angle_type, channel, COALESCE(target_audience, ''));
CREATE INDEX IF NOT EXISTS idx_ci_dest ON content_insights(destination);

-- 트리거
CREATE OR REPLACE FUNCTION update_content_creatives_ts()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_updated ON content_creatives;
CREATE TRIGGER trg_cc_updated BEFORE UPDATE ON content_creatives
  FOR EACH ROW EXECUTE FUNCTION update_content_creatives_ts();

-- RLS
ALTER TABLE content_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_cc" ON content_creatives FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cp" ON content_performance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_ci" ON content_insights FOR ALL USING (true) WITH CHECK (true);
