-- ============================================================
-- 여소남 OS: Marketing & Campaigns Enhancement
-- Migration: 20260401140000
--
-- 이미 존재 (20260401110000):
--   marketing_campaigns, campaign_engagements → ALTER만
--
-- 신규 테이블:
--   email_campaigns (이메일 캠페인 상세 + GENERATED open_rate/click_rate)
--   promotions (쿠폰/프로모션)
--   promotion_usages (사용 내역)
--
-- ALTER (기존 테이블 보완):
--   marketing_campaigns: description, target_destinations, target_customer_ids, creative_assets 추가
--   campaign_engagements: session_id, engagement_type, engagement_channel,
--                         conversion_package_id, device_type, browser, location 추가
-- ============================================================

BEGIN;

-- ============================================================
-- 1. marketing_campaigns 보완
-- ============================================================
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS target_destinations TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_customer_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS creative_assets JSONB DEFAULT '{}';

-- type CHECK 보완 — 기존 CHECK에 'search' 추가 필요 시 재생성
-- (기존 CHECK: email,sms,social,display,retargeting,content,offline)
DO $$
BEGIN
  ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_type_check;
  ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_type_check
    CHECK (type IN ('email','sms','social','display','search','retargeting','content','offline'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- channel 컬럼 — 기존 channels TEXT[] 와 별개로 단일 channel
ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT;

-- ============================================================
-- 2. campaign_engagements 보완
-- ============================================================
ALTER TABLE campaign_engagements
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS engagement_type TEXT,
  ADD COLUMN IF NOT EXISTS engagement_channel TEXT,
  ADD COLUMN IF NOT EXISTS conversion_package_id UUID,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS browser TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT;

DO $$
BEGIN
  ALTER TABLE campaign_engagements ADD CONSTRAINT chk_engagement_type
    CHECK (engagement_type IN ('impression','click','conversion'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. email_campaigns (신규)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE CASCADE,

  -- 이메일
  subject TEXT NOT NULL,
  preview_text TEXT,
  html_content TEXT,
  text_content TEXT,

  -- 발송자
  sender_name TEXT,
  sender_email TEXT,
  reply_to_email TEXT,

  -- 성과
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  unsubscribed_count INTEGER DEFAULT 0,
  bounced_count INTEGER DEFAULT 0,

  -- GENERATED 지표
  open_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN delivered_count > 0
      THEN ROUND((opened_count::NUMERIC / delivered_count) * 100, 2)
      ELSE 0
    END
  ) STORED,

  click_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN delivered_count > 0
      THEN ROUND((clicked_count::NUMERIC / delivered_count) * 100, 2)
      ELSE 0
    END
  ) STORED,

  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_campaign ON email_campaigns(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_sent ON email_campaigns(sent_at DESC);

-- ============================================================
-- 4. promotions (쿠폰/프로모션)
-- ============================================================
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,

  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK (type IN ('percentage','fixed_amount','free_upgrade','bundle')),

  -- 할인 규칙 (INTEGER = 원화, percent는 NUMERIC)
  discount_value INTEGER, -- fixed_amount: 원화, percentage: % (정수)
  min_purchase_amount INTEGER,
  max_discount_amount INTEGER,

  -- 제한
  usage_limit INTEGER,
  usage_limit_per_customer INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,

  -- 기간
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,

  -- 타겟
  applicable_packages UUID[] DEFAULT '{}',
  applicable_destinations TEXT[] DEFAULT '{}',

  -- 상태
  status TEXT DEFAULT 'active' CHECK (status IN ('active','expired','depleted','cancelled')),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(valid_from, valid_until);

-- ============================================================
-- 5. promotion_usages (사용 내역)
-- ============================================================
CREATE TABLE IF NOT EXISTS promotion_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

  -- 금액 (INTEGER = 원화)
  original_amount INTEGER,
  discount_amount INTEGER,
  final_amount INTEGER,

  used_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_usage_promotion ON promotion_usages(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_customer ON promotion_usages(customer_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_booking ON promotion_usages(booking_id);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'email_campaigns', 'promotions', 'promotion_usages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_access" ON %I', tbl);
    EXECUTE format('CREATE POLICY "authenticated_access" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

COMMIT;
