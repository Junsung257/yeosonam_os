-- ============================================================
-- 메타 광고 자동화 엔진 DB 마이그레이션
-- Supabase > SQL Editor 에서 실행하세요. (1회)
-- ============================================================

-- ① ad_campaigns 테이블 — Meta 캠페인 1:1 매핑
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  meta_campaign_id    TEXT,
  meta_adset_id       TEXT,
  meta_ad_id          TEXT,
  name                TEXT NOT NULL,
  status              TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  objective           TEXT DEFAULT 'LINK_CLICKS'
    CHECK (objective IN ('LINK_CLICKS','CONVERSIONS','REACH','BRAND_AWARENESS')),
  daily_budget_krw    INTEGER DEFAULT 0,
  total_spend_krw     INTEGER DEFAULT 0,
  started_at          DATE,
  ended_at            DATE,
  auto_pause_reason   TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_package   ON ad_campaigns(package_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status    ON ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_meta_id   ON ad_campaigns(meta_campaign_id);

-- ② ad_creatives 테이블 — AI 생성 카피 30종 (스레드/인스타/블로그 각 10개)
CREATE TABLE IF NOT EXISTS ad_creatives (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  campaign_id       UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  platform          TEXT NOT NULL CHECK (platform IN ('thread','instagram','blog')),
  variant_index     INTEGER NOT NULL CHECK (variant_index BETWEEN 1 AND 10),
  headline          TEXT,
  body_copy         TEXT NOT NULL,
  image_path        TEXT,
  meta_creative_id  TEXT,
  is_deployed       BOOLEAN DEFAULT FALSE,
  performance_score NUMERIC(5,2),
  ai_model          TEXT DEFAULT 'openai'
    CHECK (ai_model IN ('openai','claude','gemini')),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_package   ON ad_creatives(package_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign  ON ad_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_platform  ON ad_creatives(platform);

-- ③ ad_performance_snapshots 테이블 — 일별 성과 스냅샷
CREATE TABLE IF NOT EXISTS ad_performance_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  snapshot_date       DATE NOT NULL,
  impressions         INTEGER DEFAULT 0,
  clicks              INTEGER DEFAULT 0,
  spend_krw           INTEGER DEFAULT 0,
  cpc_krw             INTEGER DEFAULT 0,
  attributed_bookings INTEGER DEFAULT 0,
  attributed_margin   INTEGER DEFAULT 0,
  net_roas_pct        NUMERIC(8,2) DEFAULT 0,
  raw_meta_json       JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ad_perf_campaign  ON ad_performance_snapshots(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_date      ON ad_performance_snapshots(snapshot_date);

-- ④ bookings 테이블 UTM 컬럼 추가
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_source   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_medium   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_content  TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_attributed_campaign_id UUID
  REFERENCES ad_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_utm_campaign    ON bookings(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_bookings_utm_attributed  ON bookings(utm_attributed_campaign_id);

COMMENT ON COLUMN bookings.utm_campaign IS
  '광고 클릭 시 URL에서 수집된 UTM campaign 파라미터 (Meta campaign ID와 일치)';
COMMENT ON COLUMN bookings.utm_attributed_campaign_id IS
  'ROAS 귀속용 FK. 라스트 클릭 기준 — affiliate보다 UTM이 우선';

-- ⑤ ad_campaigns updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_ad_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ad_campaigns_updated_at ON ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_updated_at
  BEFORE UPDATE ON ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_ad_campaigns_updated_at();

-- ⑥ app_settings 초기값 — CPC 임계값 (없으면 삽입)
INSERT INTO app_settings (key, value)
VALUES ('meta_cpc_threshold', '2000')
ON CONFLICT (key) DO NOTHING;

-- 확인 쿼리
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ad_campaigns','ad_creatives','ad_performance_snapshots')
ORDER BY table_name;
