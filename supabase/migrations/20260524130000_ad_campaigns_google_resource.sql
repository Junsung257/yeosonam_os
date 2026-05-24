-- ============================================================
-- Ad Campaigns — google_resource_name 컬럼 추가
-- 마이그레이션: 20260524130000
-- 목적:
--   AdPublishAgent가 Google Ads API 캠페인 생성 후
--   resource name (예: customers/123/campaigns/456) 을 저장하기 위함
-- ============================================================

BEGIN;

-- ── 1. ad_campaigns에 google_resource_name 추가 ─────────────────────────────
ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS google_resource_name TEXT;

COMMENT ON COLUMN ad_campaigns.google_resource_name IS 'Google Ads API 캠페인 resource name (customers/{id}/campaigns/{id})';

-- ── 2. google_resource_name 인덱스 (조회 최적화) ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_google_resource
  ON ad_campaigns(google_resource_name)
  WHERE google_resource_name IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
