-- ============================================================
-- 어필리에이터 콘텐츠 어트리뷰션 (2026-04-26)
--
-- content_distributions에 어필리에이터·콘텐츠 크리에이티브 ID 추가.
--   - affiliate_id: 어떤 어필리에이터가 만든 콘텐츠인가
--   - is_co_branded: 어필리에이터+여소남 동시 노출(co-branding) 콘텐츠 여부
--   - ad_disclosure: 공정위 추천·보증 심사지침 자동 워터마크 ('광고')
--   - bookings.content_creative_id 와 매칭하여 콘텐츠별 매출 기여도 계산
-- ============================================================

BEGIN;

ALTER TABLE content_distributions
  ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL;

ALTER TABLE content_distributions
  ADD COLUMN IF NOT EXISTS is_co_branded BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE content_distributions
  ADD COLUMN IF NOT EXISTS ad_disclosure TEXT;

CREATE INDEX IF NOT EXISTS idx_cd_affiliate ON content_distributions(affiliate_id)
  WHERE affiliate_id IS NOT NULL;

COMMENT ON COLUMN content_distributions.affiliate_id IS
  '어필리에이터가 자신의 포털에서 만든 콘텐츠일 때 FK';
COMMENT ON COLUMN content_distributions.is_co_branded IS
  'true = 어필리에이터 이름+로고가 콘텐츠 본문에 노출됨';
COMMENT ON COLUMN content_distributions.ad_disclosure IS
  '공정위 추천·보증 심사지침 워터마크 (예: "여소남 제휴 콘텐츠 (광고)")';

COMMIT;

NOTIFY pgrst, 'reload schema';
