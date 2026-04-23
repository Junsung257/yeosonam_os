-- ============================================================
-- 경쟁사 Meta Ad Library 스냅샷
-- 마이그레이션: 20260423040000
-- 목적:
--   경쟁사 (모두투어/하나투어/마이리얼트립 등) 의 Meta 광고를 수집해
--   카피 패턴·톤·혜택 제시 방식을 분석. 우리 Meta Ads agent 프롬프트에 주입.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS competitor_ad_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand             TEXT NOT NULL,                 -- '모두투어', '하나투어' 등
  platform          TEXT NOT NULL DEFAULT 'meta_ads'
    CHECK (platform IN ('meta_ads','google_ads','naver_ads','kakao_ads','instagram_organic')),
  ad_library_id     TEXT,                          -- Meta Ad Library URL 의 ad_id
  source_url        TEXT,                          -- 원본 URL
  creative_urls     TEXT[],                        -- 이미지·영상 URL 배열
  copy_primary      TEXT NOT NULL,                 -- 본문
  copy_headline     TEXT,                          -- 헤드라인
  copy_description  TEXT,                          -- 설명
  cta_button        TEXT,                          -- 버튼 (SHOP_NOW, BOOK_TRAVEL 등)
  landing_url       TEXT,

  -- 메타 (수동 입력 또는 크롤링)
  product_category  TEXT,                          -- '해외여행','국내여행','항공권' 등
  destination_hint  TEXT,                          -- '보홀','다낭' 등
  promo_type        TEXT,                          -- 'early_bird','last_minute','seasonal' 등

  -- 성과 (Meta Ad Library 가 제공하는 수준: impressions_lower/upper, spend_lower/upper)
  impressions_lower BIGINT,
  impressions_upper BIGINT,
  spend_lower_krw   BIGINT,
  spend_upper_krw   BIGINT,
  active_days       INTEGER,                       -- 광고 게재 일수 (긴 게 성과 좋은 신호)

  -- AI 분석 결과
  analysis          JSONB DEFAULT '{}'::jsonb,     -- 패턴·키워드·톤 분석
  ctr_estimate      NUMERIC(5,4),                  -- 0.0123 = 1.23%

  -- 메타
  captured_at       TIMESTAMPTZ DEFAULT now(),
  captured_by       TEXT,                          -- 'manual' | 'crawler' | 'api'
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cas_brand       ON competitor_ad_snapshots(brand);
CREATE INDEX IF NOT EXISTS idx_cas_platform    ON competitor_ad_snapshots(platform);
CREATE INDEX IF NOT EXISTS idx_cas_destination ON competitor_ad_snapshots(destination_hint);
CREATE INDEX IF NOT EXISTS idx_cas_captured    ON competitor_ad_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cas_active_days ON competitor_ad_snapshots(active_days DESC NULLS LAST);

COMMENT ON TABLE competitor_ad_snapshots IS '경쟁사 Meta Ad Library 등 광고 스냅샷 — 패턴 학습용';

COMMIT;

NOTIFY pgrst, 'reload schema';
