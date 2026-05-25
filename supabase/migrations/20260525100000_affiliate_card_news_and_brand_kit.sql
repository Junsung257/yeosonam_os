-- ============================================================
-- Phase 2-A: 어필리에이터 카드뉴스 + Brand Kit
-- 1. brand_kits 테이블 (테넌트/어필리에이터 공용)
-- 2. affiliates 테이블에 콘텐츠 관련 컬럼 추가
-- 3. card_news 테이블에 created_by_affiliate_id 컬럼 추가
-- ============================================================

-- 1. Brand Kit (테넌트/어필리에이터 공용)
CREATE TABLE IF NOT EXISTS brand_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('tenant', 'affiliate', 'platform')),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '기본 브랜드',
  -- 핵심 브랜드 토큰
  primary_color TEXT NOT NULL DEFAULT '#001f3f',
  accent_color TEXT NOT NULL DEFAULT '#005d90',
  background_color TEXT NOT NULL DEFAULT '#f8f9fb',
  font_family TEXT NOT NULL DEFAULT 'Pretendard',
  logo_url TEXT,
  logo_light_url TEXT,          -- 다크 배경용 로고
  brand_name TEXT NOT NULL DEFAULT '',
  brand_tagline TEXT,
  -- 고급 설정
  watermark_text TEXT,           -- '여소남 제공' 등
  watermark_enabled BOOLEAN DEFAULT true,
  social_links JSONB DEFAULT '{}'::jsonb,
  -- 메타
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 동일 소유자 중복 방지
  UNIQUE (owner_type, owner_id)
);

-- brand_kits RLS (service_role 전용)
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_kits_service_only ON brand_kits
  FOR ALL USING (auth.role() = 'service_role');

-- 2. affiliates 테이블에 콘텐츠 관련 컬럼 추가
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  content_quota INTEGER DEFAULT 10;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  content_used INTEGER DEFAULT 0;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  content_quota_reset_at DATE DEFAULT CURRENT_DATE;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  branding_level TEXT DEFAULT 'powered_by'
    CHECK (branding_level IN ('powered_by', 'co_brand', 'white_label'));
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  template_tier TEXT DEFAULT 'basic'
    CHECK (template_tier IN ('basic', 'premium', 'all'));
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  auto_publish_instagram BOOLEAN DEFAULT false;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  auto_publish_blog BOOLEAN DEFAULT false;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS
  api_access BOOLEAN DEFAULT false;

-- 3. card_news 테이블에 어필리에이터 컬럼 추가
ALTER TABLE card_news ADD COLUMN IF NOT EXISTS
  created_by_affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL;
ALTER TABLE card_news ADD COLUMN IF NOT EXISTS
  branding_level TEXT DEFAULT 'platform'
    CHECK (branding_level IN ('platform', 'powered_by', 'co_brand', 'white_label'));
ALTER TABLE card_news ADD COLUMN IF NOT EXISTS
  brand_kit_id UUID REFERENCES brand_kits(id) ON DELETE SET NULL;

-- 4. 월별 사용량 추적 (어필리에이터용)
CREATE TABLE IF NOT EXISTS affiliate_monthly_usage (
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  month DATE NOT NULL,  -- 첫날 (예: 2026-05-01)
  content_generated INTEGER NOT NULL DEFAULT 0,
  blog_posts_generated INTEGER NOT NULL DEFAULT 0,
  ig_posts_published INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (affiliate_id, month)
);

ALTER TABLE affiliate_monthly_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_monthly_usage_service_only ON affiliate_monthly_usage
  FOR ALL USING (auth.role() = 'service_role');

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_card_news_created_by_affiliate ON card_news(created_by_affiliate_id)
  WHERE created_by_affiliate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_kits_owner ON brand_kits(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_monthly_usage_month ON affiliate_monthly_usage(month);
