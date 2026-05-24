-- ══════════════════════════════════════════════════════════
-- 2026-05-24: 보안 수정 — RLS 누락 테이블 + 만료 정리 cron
-- ══════════════════════════════════════════════════════════
-- 1. 6개 테이블 RLS 활성화 + 접근 제한 정책
-- 2. social_platform_configs: RLS 우선 적용 (암호화는 Phase 2)
-- 3. external_trend_posts: 만료 정리 cron 등록
-- ══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. content_distributions ────────────────────────────

ALTER TABLE content_distributions ENABLE ROW LEVEL SECURITY;

-- service_role만 모든 접근 가능 (내부 파이프라인 전용)
CREATE POLICY "content_distributions_service_role_all"
  ON content_distributions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated 사용자는 읽기만 가능 (모니터링/대시보드)
CREATE POLICY "content_distributions_auth_select"
  ON content_distributions
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 2. social_platform_configs ──────────────────────────

ALTER TABLE social_platform_configs ENABLE ROW LEVEL SECURITY;

-- service_role만 모든 접근 가능 (토큰 보호)
CREATE POLICY "social_platform_configs_service_role_all"
  ON social_platform_configs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated 사용자는 민감 정보 제외한 읽기만
CREATE POLICY "social_platform_configs_auth_select_safe"
  ON social_platform_configs
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 참고: access_token 컬럼 암호화는 Phase 2에서 진행 ──
-- pgp_sym_encrypt() 또는 Supabase Vault 사용 예정
-- 마이그레이션: 20260524XXXXXX_encrypt_social_tokens.sql

-- ── 3. competitor_ad_snapshots ──────────────────────────

ALTER TABLE competitor_ad_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitor_ad_snapshots_service_role_all"
  ON competitor_ad_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "competitor_ad_snapshots_auth_select"
  ON competitor_ad_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 4. bandit_arms ──────────────────────────────────────

ALTER TABLE bandit_arms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bandit_arms_service_role_all"
  ON bandit_arms
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "bandit_arms_auth_select"
  ON bandit_arms
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 5. customer_segments ────────────────────────────────

ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_segments_service_role_all"
  ON customer_segments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "customer_segments_auth_select"
  ON customer_segments
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 6. customer_rfm ─────────────────────────────────────

ALTER TABLE customer_rfm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_rfm_service_role_all"
  ON customer_rfm
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "customer_rfm_auth_select"
  ON customer_rfm
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 7. external_trend_posts: 만료 정리 함수 + cron ──────
--
-- Threads 트렌드 마이너에만 임시 delete 로직이 있고 IG 마이너에는 없음.
-- 전용 함수를 만들어 pg_cron 또는 Vercel Cron으로 호출 가능하도록 함.

CREATE OR REPLACE FUNCTION cleanup_expired_trend_posts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM external_trend_posts
  WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ── 8. segment_campaign_logs: RLS 정책 추가 ────────────
-- (테이블 생성 시 ENABLE RLS만 있고 정책은 없었음)

ALTER TABLE IF EXISTS segment_campaign_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segment_campaign_logs_service_role_all"
  ON segment_campaign_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "segment_campaign_logs_auth_select"
  ON segment_campaign_logs
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;

-- ── 적용 확인 ──────────────────────────────────────────
-- SELECT tablename FROM pg_tables
-- WHERE tablename IN (
--   'content_distributions', 'social_platform_configs',
--   'competitor_ad_snapshots', 'bandit_arms',
--   'customer_segments', 'customer_rfm', 'segment_campaign_logs'
-- );
--
-- SELECT
--   relname AS table_name,
--   relrowsecurity AS rls_enabled
-- FROM pg_class
-- WHERE relname IN (
--   'content_distributions', 'social_platform_configs',
--   'competitor_ad_snapshots', 'bandit_arms',
--   'customer_segments', 'customer_rfm', 'segment_campaign_logs'
-- )
-- ORDER BY relname;
