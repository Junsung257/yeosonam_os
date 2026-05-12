-- 랜드사 파트너 포털 접근 토큰 (장기 유효)
ALTER TABLE land_operators
  ADD COLUMN IF NOT EXISTS portal_access_token TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN land_operators.portal_access_token IS '랜드사 포털 접근용 Bearer 토큰 (UUID). 발급 시 알림 발송';
CREATE UNIQUE INDEX IF NOT EXISTS idx_land_operators_portal_token
  ON land_operators (portal_access_token)
  WHERE portal_access_token IS NOT NULL;
