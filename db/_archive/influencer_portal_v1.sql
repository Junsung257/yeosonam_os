-- ============================================================
-- influencer_portal_v1: 인플루언서 포털 확장
-- ============================================================

-- 1. PIN 인증 (phone 뒷자리 4자리 — 간편 인증용)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pin TEXT;

-- 2. 인플루언서 로고 URL (자체 브랜딩용)
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 3. 인플루언서 생성 링크 테이블
CREATE TABLE IF NOT EXISTS influencer_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  referral_code TEXT NOT NULL,
  package_id UUID NOT NULL,
  package_title TEXT,
  short_url TEXT,
  click_count INTEGER DEFAULT 0,
  conversion_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inf_links_affiliate ON influencer_links(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_inf_links_referral ON influencer_links(referral_code);
CREATE INDEX IF NOT EXISTS idx_inf_links_package ON influencer_links(package_id);

-- 4. 기존 phone에서 PIN 자동 세팅 (뒷자리 4자리)
UPDATE affiliates
SET pin = RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 4)
WHERE phone IS NOT NULL AND pin IS NULL;
