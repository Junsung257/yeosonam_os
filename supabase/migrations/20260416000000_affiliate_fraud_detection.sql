-- ============================================================
-- 여소남 OS: 어필리에이트 부정 방지
-- 마이그레이션: 20260416000000
-- 목적:
--   1. bookings.self_referral_flag / self_referral_reason — 셀프 리퍼럴 예약 표시(수수료 제외)
--   2. affiliate_geo_anomalies 뷰 — 하루 21개 이상 고유 IP로 유입된 referral_code
-- ============================================================

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS self_referral_flag BOOLEAN DEFAULT FALSE;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS self_referral_reason TEXT;

CREATE OR REPLACE VIEW affiliate_geo_anomalies AS
SELECT
  referral_code,
  date_trunc('day', clicked_at)::date AS day,
  COUNT(DISTINCT ip_hash) AS unique_ips
FROM affiliate_touchpoints
WHERE is_bot = FALSE
  AND is_duplicate = FALSE
  AND ip_hash IS NOT NULL
GROUP BY referral_code, date_trunc('day', clicked_at)::date
HAVING COUNT(DISTINCT ip_hash) > 20;

COMMENT ON VIEW affiliate_geo_anomalies IS
  '하루 동안 같은 referral_code로 21개 이상의 고유 IP 해시가 유입된 경우. anomaly 크론이 감지.';

COMMIT;
