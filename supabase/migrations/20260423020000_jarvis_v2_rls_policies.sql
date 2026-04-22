-- V2 §B.2.4 — Row Level Security 정책 (Defense in Depth)
--
-- 이 마이그레이션은 **RLS 정책을 정의만** 하고 **바로 활성화하지 않는다**.
-- 정책 등록 후 백필 완료 및 QA 검증이 끝나면 별도 PR 에서 ALTER TABLE ... ENABLE RLS 수행.
--
-- 정책 구조:
--   platform_admin        → 전체 허용
--   STRICT 테이블 + tenant→ tenant_id 일치만
--   NULLABLE 테이블        → tenant_id NULL 또는 일치
--
-- 활성화는 아래 한 줄을 주석 해제하면 됨 (Phase 3d):
--   -- SELECT jarvis_enable_rls();

-- 기존 함수 존재 시 제거 (42P13 회피)
DROP FUNCTION IF EXISTS jarvis_is_platform_admin();
DROP FUNCTION IF EXISTS jarvis_current_tenant();

-- ─── 공통 헬퍼: 현재 요청이 platform_admin 인지 ────────────────────────
CREATE OR REPLACE FUNCTION jarvis_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.user_role', true) = 'platform_admin'
$$;

-- ─── 공통 헬퍼: 현재 요청의 tenant_id ─────────────────────────────────
CREATE OR REPLACE FUNCTION jarvis_current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ─── STRICT 테이블 정책 — 있는 테이블에만 ──────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'bookings','customers','payments','bank_transactions','message_logs',
    'settlements','jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions',
    'agent_actions'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      EXECUTE format('DROP POLICY IF EXISTS jarvis_v2_tenant_isolation ON %I', t);
      EXECUTE format($p$
        CREATE POLICY jarvis_v2_tenant_isolation ON %I
          USING (jarvis_is_platform_admin() OR tenant_id = jarvis_current_tenant())
          WITH CHECK (jarvis_is_platform_admin() OR tenant_id = jarvis_current_tenant())
      $p$, t);
      RAISE NOTICE '✅ STRICT policy on %', t;
    ELSE
      RAISE NOTICE '⏭  Skipped STRICT: % (not exists)', t;
    END IF;
  END LOOP;
END $$;

-- ─── NULLABLE 테이블 정책 — tenant_id 컬럼 있는 테이블에만 ──────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'travel_packages','error_patterns','customer_facts',
    'content_creatives','content_daily_stats','content_insights'
  ]) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'tenant_id' AND table_schema = 'public'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS jarvis_v2_tenant_or_shared ON %I', t);
      EXECUTE format($p$
        CREATE POLICY jarvis_v2_tenant_or_shared ON %I
          USING (
            jarvis_is_platform_admin()
            OR tenant_id IS NULL
            OR tenant_id = jarvis_current_tenant()
          )
          WITH CHECK (
            jarvis_is_platform_admin()
            OR tenant_id = jarvis_current_tenant()
          )
      $p$, t);
      RAISE NOTICE '✅ NULLABLE policy on %', t;
    ELSE
      RAISE NOTICE '⏭  Skipped NULLABLE: % (no tenant_id column)', t;
    END IF;
  END LOOP;
END $$;

-- ─── 활성화/비활성화 헬퍼 (Phase 3d 에서 호출, 없는 테이블 자동 스킵) ───
DROP FUNCTION IF EXISTS jarvis_enable_rls();
DROP FUNCTION IF EXISTS jarvis_disable_rls();

CREATE OR REPLACE FUNCTION jarvis_enable_rls()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'bookings','customers','payments','bank_transactions','message_logs',
    'settlements','jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions',
    'agent_actions',
    'travel_packages','error_patterns','customer_facts',
    'content_creatives','content_daily_stats','content_insights'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION jarvis_disable_rls()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'bookings','customers','payments','bank_transactions','message_logs',
    'settlements','jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions',
    'agent_actions',
    'travel_packages','error_patterns','customer_facts',
    'content_creatives','content_daily_stats','content_insights'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION jarvis_enable_rls IS
  'Phase 3d 활성화 훅. 백필 완료·QA 검증 후 SELECT jarvis_enable_rls(); 실행.';
COMMENT ON FUNCTION jarvis_disable_rls IS
  '긴급 롤백용. RLS 가 서비스 차단 시 SELECT jarvis_disable_rls();';
