-- V2 §B.2.5 — Request Context RPC
--
-- 자비스 V2 의 매 요청마다 현재 요청의 테넌트·유저 컨텍스트를 세션 변수에 주입.
-- RLS 정책이 current_setting('app.tenant_id') 를 읽어 격리 규칙을 적용한다.
--
-- 안전성:
-- - SET LOCAL 을 쓰지 않는 이유: Supabase JS client 는 단일 statement RPC 호출이므로
--   SET LOCAL 은 트랜잭션 범위에 묶여 즉시 해제됨. 대신 set_config(..., is_local := true) 로
--   동일 효과 (현재 트랜잭션 스코프 only).
-- - SECURITY DEFINER 로 role-switch 없이 호출 가능하지만, 인자를 신뢰하기 전에
--   반드시 호출부에서 인증 검증을 거칠 것 (middleware + JWT).

CREATE OR REPLACE FUNCTION set_jarvis_request_context(
  p_tenant_id UUID,
  p_user_role TEXT,
  p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- is_local := true → 현재 트랜잭션 범위에서만 유효.
  -- 트랜잭션 외 호출이면 세션 범위로 적용됨 (커넥션 pool 주의).
  PERFORM set_config('app.tenant_id', COALESCE(p_tenant_id::text, ''), true);
  PERFORM set_config('app.user_role', COALESCE(p_user_role, 'anonymous'), true);
  PERFORM set_config('app.user_id',   COALESCE(p_user_id::text, ''), true);
END;
$$;

-- service_role + authenticated 모두 호출 가능하게 (자비스는 service_role 사용 중)
GRANT EXECUTE ON FUNCTION set_jarvis_request_context(UUID, TEXT, UUID) TO authenticated, service_role, anon;

-- 현재 컨텍스트 확인용 (디버깅·감사)
CREATE OR REPLACE FUNCTION current_jarvis_context()
RETURNS TABLE(tenant_id TEXT, user_role TEXT, user_id TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('app.tenant_id', true),
    current_setting('app.user_role', true),
    current_setting('app.user_id',   true);
$$;

GRANT EXECUTE ON FUNCTION current_jarvis_context() TO authenticated, service_role;

COMMENT ON FUNCTION set_jarvis_request_context IS
  '자비스 V2 — 요청별 테넌트/유저 컨텍스트 주입. RLS 정책이 current_setting 으로 참조.';
