-- ============================================================
-- 여소남 OS: 어필리에이트 멀티터치 기록 + 중복 클릭 필터
-- 마이그레이션: 20260415000000
-- 목적:
--   1. affiliate_touchpoints — 전체 여정 기록(지급은 last-click 유지)
--   2. influencer_links.unique_visitor_count — 고유 방문자 집계
--   3. is_duplicate_click RPC — 같은 세션+ref+pkg 10분 내 재클릭 판정
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS affiliate_touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  package_id UUID,
  sub_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  is_bot BOOLEAN DEFAULT FALSE,
  is_duplicate BOOLEAN DEFAULT FALSE,
  clicked_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atp_ref_session
  ON affiliate_touchpoints(referral_code, session_id, clicked_at);

CREATE INDEX IF NOT EXISTS idx_atp_ref_date
  ON affiliate_touchpoints(referral_code, clicked_at);

CREATE INDEX IF NOT EXISTS idx_atp_ip_date
  ON affiliate_touchpoints(ip_hash, clicked_at)
  WHERE is_bot = FALSE;

ALTER TABLE influencer_links
  ADD COLUMN IF NOT EXISTS unique_visitor_count INT DEFAULT 0;

CREATE OR REPLACE FUNCTION is_duplicate_click(
  p_session TEXT,
  p_ref TEXT,
  p_pkg UUID
)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM affiliate_touchpoints
    WHERE session_id = p_session
      AND referral_code = p_ref
      AND (package_id IS NOT DISTINCT FROM p_pkg)
      AND clicked_at > now() - interval '10 minutes'
  );
$$;

COMMENT ON TABLE affiliate_touchpoints IS
  '어필리에이트 클릭 여정 전체 기록. 지급은 last-click 유지, 본 테이블은 분석/이상탐지 용도.';
COMMENT ON FUNCTION is_duplicate_click IS
  '같은 세션+referral_code+package에서 10분 내 재클릭 여부. true면 click_count 미증가.';

COMMIT;
