-- ============================================================
-- 여소남 광고 소재 공장 (Creative Engine) DB 마이그레이션 v1
-- Supabase SQL Editor에서 실행
-- 2026-03-29
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. travel_packages 테이블 확장 (기존 데이터 보존, 컬럼 추가만)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS parsed_data JSONB,
  ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_text_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS country VARCHAR(50),
  ADD COLUMN IF NOT EXISTS nights INT;

-- destination은 이미 존재하므로 스킵
-- product_summary, product_highlights, product_type, airline, departure_airport 이미 존재

COMMENT ON COLUMN travel_packages.parsed_data IS 'Gemini 파싱 결과 JSON (캐시용, 7일 TTL)';
COMMENT ON COLUMN travel_packages.parsed_at IS 'parsed_data 생성 시각';
COMMENT ON COLUMN travel_packages.raw_text_hash IS '원문 해시 (변경 감지용)';
COMMENT ON COLUMN travel_packages.country IS '국가명 (베트남, 일본 등)';
COMMENT ON COLUMN travel_packages.nights IS '숙박 수 (3박5일이면 3)';


-- ══════════════════════════════════════════════════════════════
-- 2. ad_campaigns 테이블 (Meta/네이버/구글 캠페인 1:1 매핑)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- Meta
  meta_campaign_id    TEXT,
  meta_adset_id       TEXT,
  meta_ad_id          TEXT,

  -- 네이버
  naver_campaign_id   TEXT,
  naver_adgroup_id    TEXT,
  naver_ad_id         TEXT,

  -- 구글
  google_campaign_id  TEXT,
  google_adgroup_id   TEXT,
  google_ad_id        TEXT,

  name                TEXT NOT NULL,
  channel             TEXT DEFAULT 'meta'
    CHECK (channel IN ('meta', 'naver', 'google')),
  status              TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  objective           TEXT DEFAULT 'LINK_CLICKS'
    CHECK (objective IN ('LINK_CLICKS', 'CONVERSIONS', 'REACH', 'BRAND_AWARENESS')),
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
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_channel   ON ad_campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_meta_id   ON ad_campaigns(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════
-- 3. ad_creatives 테이블 (광고 소재 — 캐러셀/단일이미지/텍스트광고)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_creatives (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID REFERENCES travel_packages(id) ON DELETE CASCADE,
  campaign_id         UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,

  -- 소재 분류
  creative_type       TEXT NOT NULL
    CHECK (creative_type IN ('carousel', 'single_image', 'text_ad', 'short_video')),
  channel             TEXT NOT NULL
    CHECK (channel IN ('meta', 'naver', 'google')),
  variant_index       INT DEFAULT 0,

  -- 카피 메타 (학습 엔진 핵심)
  hook_type           TEXT
    CHECK (hook_type IN ('urgency', 'benefit', 'scene', 'question', 'price',
                         'price_hero', 'scene_mood', 'benefit_list',
                         'destination', 'feature', 'departure')),
  tone                TEXT
    CHECK (tone IN ('urgent', 'emotional', 'trust', 'informative')),
  key_selling_point   TEXT,
  target_segment      TEXT DEFAULT 'middle_age'
    CHECK (target_segment IN ('middle_age', 'couple', 'group', 'family')),

  -- 소재 내용 (타입별 사용)
  slides              JSONB,          -- carousel: [{role, headline, body, image_url, pexels_keyword}]
  headline            TEXT,           -- single_image, text_ad
  primary_text        TEXT,           -- single_image (Meta 피드 상단)
  description         TEXT,           -- single_image, text_ad
  body                TEXT,
  image_url           TEXT,
  keywords            TEXT[],         -- text_ad: 타겟 키워드 목록
  ad_copies           JSONB,          -- text_ad: [{title1, title2, description, landing_url}]

  -- 배포 정보
  utm_params          JSONB,
  meta_campaign_id    TEXT,
  meta_adset_id       TEXT,
  meta_ad_id          TEXT,
  meta_creative_id    TEXT,
  naver_campaign_id   TEXT,
  naver_adgroup_id    TEXT,
  naver_ad_id         TEXT,
  google_campaign_id  TEXT,
  google_adgroup_id   TEXT,
  google_ad_id        TEXT,

  -- 상태
  status              TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'active', 'paused', 'ended')),

  created_at          TIMESTAMPTZ DEFAULT now(),
  launched_at         TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_product   ON ad_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign   ON ad_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_status     ON ad_creatives(status);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_type       ON ad_creatives(creative_type, channel);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_hook       ON ad_creatives(hook_type);


-- ══════════════════════════════════════════════════════════════
-- 4. creative_performance 테이블 (크리에이티브 단위 일별 성과)
--    기존 ad_performance_snapshots(캠페인 단위)와 별도 공존
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creative_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id     UUID NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL
    CHECK (channel IN ('meta', 'naver', 'google')),
  date            DATE NOT NULL,

  -- 노출/클릭
  impressions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  ctr             DECIMAL(8,4),         -- clicks/impressions * 100 (%)

  -- 비용
  spend           DECIMAL(10,2) DEFAULT 0,
  cpc             DECIMAL(8,2),         -- spend/clicks

  -- 전환 (픽셀/스크립트 필요)
  inquiries       INT DEFAULT 0,        -- Lead 이벤트
  bookings        INT DEFAULT 0,        -- Purchase 이벤트
  revenue         DECIMAL(12,2) DEFAULT 0,
  roas            DECIMAL(8,2),         -- revenue/spend

  -- Meta 추가 지표
  reach           INT,
  frequency       DECIMAL(4,2),
  video_views     INT,                  -- 숏폼용

  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(creative_id, channel, date)
);

CREATE INDEX IF NOT EXISTS idx_creative_perf_creative ON creative_performance(creative_id);
CREATE INDEX IF NOT EXISTS idx_creative_perf_date     ON creative_performance(date);
CREATE INDEX IF NOT EXISTS idx_creative_perf_channel  ON creative_performance(channel);


-- ══════════════════════════════════════════════════════════════
-- 5. winning_patterns 테이블 (학습 엔진 핵심 — 승리 패턴 저장)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS winning_patterns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 어떤 조건에서 (컨텍스트)
  destination_type     TEXT,
    -- '동남아단거리'(3-5박) | '동남아장거리'(6박+) | '일본' | '유럽' | '기타'
  channel              TEXT,
  target_segment       TEXT,
  nights_range         TEXT,          -- '1-3박' | '4-5박' | '6-7박' | '8박이상'
  price_range          TEXT,          -- '50만미만' | '50-100만' | '100만이상'

  -- 뭐가 잘 되는지 (패턴)
  hook_type            TEXT,
  tone                 TEXT,
  key_selling_point    TEXT,
  creative_type        TEXT,

  -- 얼마나 잘 되는지 (성과)
  avg_ctr              DECIMAL(8,4),
  avg_conv_rate        DECIMAL(8,4),   -- inquiries/clicks
  avg_roas             DECIMAL(8,2),
  total_spend          DECIMAL(12,2),
  sample_count         INT DEFAULT 0,
  confidence_score     DECIMAL(4,2),   -- 0~1 (5000 노출 = 1.0)

  -- 베스트 카피 예시
  best_headline        TEXT,
  best_body            TEXT,
  best_hook_example    TEXT,

  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),

  UNIQUE(destination_type, channel, target_segment, hook_type, creative_type)
);

CREATE INDEX IF NOT EXISTS idx_winning_dest    ON winning_patterns(destination_type);
CREATE INDEX IF NOT EXISTS idx_winning_channel ON winning_patterns(channel);


-- ══════════════════════════════════════════════════════════════
-- 6. creative_edits 테이블 (에디터 수정 추적)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creative_edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id     UUID NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  slide_index     INT,
  field           TEXT NOT NULL,     -- 'headline' | 'body' | 'image' | 'keyword' | 'slides'
  before_value    TEXT,
  after_value     TEXT,
  edited_by       TEXT,              -- 사용자 ID 또는 'ai'
  edited_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_edits_creative ON creative_edits(creative_id);


-- ══════════════════════════════════════════════════════════════
-- 7. ad_performance_snapshots 테이블 (캠페인 단위 — 기존 설계 유지)
--    creative_performance와 공존 (캠페인↔크리에이티브 각각 추적)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_performance_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  snapshot_date       DATE NOT NULL,
  impressions         INT DEFAULT 0,
  clicks              INT DEFAULT 0,
  spend_krw           INT DEFAULT 0,
  cpc_krw             INT DEFAULT 0,
  attributed_bookings INT DEFAULT 0,
  attributed_margin   INT DEFAULT 0,
  net_roas_pct        DECIMAL(8,2) DEFAULT 0,
  raw_meta_json       JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ad_perf_campaign  ON ad_performance_snapshots(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_date      ON ad_performance_snapshots(snapshot_date);


-- ══════════════════════════════════════════════════════════════
-- 8. bookings 테이블 UTM 컬럼 추가 (이미 있으면 무시)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_source   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_medium   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_content  TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_attributed_campaign_id UUID
  REFERENCES ad_campaigns(id) ON DELETE SET NULL;


-- ══════════════════════════════════════════════════════════════
-- 9. updated_at 자동 갱신 트리거
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ad_campaigns
DROP TRIGGER IF EXISTS trg_ad_campaigns_updated ON ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_updated
  BEFORE UPDATE ON ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- winning_patterns
DROP TRIGGER IF EXISTS trg_winning_patterns_updated ON winning_patterns;
CREATE TRIGGER trg_winning_patterns_updated
  BEFORE UPDATE ON winning_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ══════════════════════════════════════════════════════════════
-- 10. RLS 정책 (서비스 키 사용 시 우회되지만 안전장치)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE winning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_performance_snapshots ENABLE ROW LEVEL SECURITY;

-- 서비스 역할(authenticated)에 대한 전체 접근 허용
-- 실제 운영에서는 tenant_id 기반 RLS로 교체
-- DROP 후 CREATE로 멱등성 보장 (IF NOT EXISTS 미지원)
DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_all_ad_campaigns" ON ad_campaigns;
  DROP POLICY IF EXISTS "admin_all_ad_creatives" ON ad_creatives;
  DROP POLICY IF EXISTS "admin_all_creative_performance" ON creative_performance;
  DROP POLICY IF EXISTS "admin_all_winning_patterns" ON winning_patterns;
  DROP POLICY IF EXISTS "admin_all_creative_edits" ON creative_edits;
  DROP POLICY IF EXISTS "admin_all_ad_perf_snapshots" ON ad_performance_snapshots;
END $$;

CREATE POLICY "admin_all_ad_campaigns"
  ON ad_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_ad_creatives"
  ON ad_creatives FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_creative_performance"
  ON creative_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_winning_patterns"
  ON winning_patterns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_creative_edits"
  ON creative_edits FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_ad_perf_snapshots"
  ON ad_performance_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ══════════════════════════════════════════════════════════════
-- 완료
-- ══════════════════════════════════════════════════════════════
-- 생성된 테이블:
--   1. ad_campaigns          (캠페인 — Meta/네이버/구글)
--   2. ad_creatives          (소재 — 캐러셀/단일이미지/텍스트광고/숏폼)
--   3. creative_performance  (크리에이티브 단위 일별 성과)
--   4. winning_patterns      (학습 엔진 — 승리 패턴)
--   5. creative_edits        (에디터 수정 추적)
--   6. ad_performance_snapshots (캠페인 단위 일별 성과)
--
-- 수정된 테이블:
--   1. travel_packages       (parsed_data, country, nights 컬럼 추가)
--   2. bookings              (UTM 컬럼 추가)
