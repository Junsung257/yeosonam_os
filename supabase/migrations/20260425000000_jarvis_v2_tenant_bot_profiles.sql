-- V2 §B.4.1 — Tenant Bot Profiles + Cost Ledger
--
-- 각 테넌트(여행사)에게 할당되는 전용 봇의 설정과 사용량 추적.
-- 플랫폼(여소남)은 큰 프로세스를 소유, 테넌트는 페르소나·가드레일·쿼터를 소유.

-- 실측 42703: 이전 세팅에 일부 컬럼이 없는 broken 테이블 발견 시 빈 테이블이면 재생성.
DO $$
DECLARE cnt INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jarvis_cost_ledger' AND table_schema = 'public') THEN
    EXECUTE 'SELECT count(*) FROM jarvis_cost_ledger' INTO cnt;
    IF cnt > 0 THEN
      RAISE EXCEPTION 'jarvis_cost_ledger 에 % 건 데이터 있음. 수동 백업 필요', cnt;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_bot_profiles' AND table_schema = 'public') THEN
    EXECUTE 'SELECT count(*) FROM tenant_bot_profiles' INTO cnt;
    IF cnt > 0 THEN
      RAISE EXCEPTION 'tenant_bot_profiles 에 % 건 데이터 있음. 수동 백업 필요', cnt;
    END IF;
  END IF;
END $$;

DROP VIEW IF EXISTS jarvis_monthly_usage;
DROP TABLE IF EXISTS jarvis_cost_ledger CASCADE;
DROP TABLE IF EXISTS tenant_bot_profiles CASCADE;

-- ─── tenant_bot_profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- 표시
  bot_name              TEXT NOT NULL,                            -- 예: "ABC투어 여행 컨시어지"
  greeting              TEXT,                                     -- 첫 인사말
  persona_prompt        TEXT,                                     -- 테넌트 커스텀 페르소나 (base 에 append)

  -- 권한
  allowed_agents        TEXT[] NOT NULL DEFAULT ARRAY['concierge','operations'],
  allowed_tools         TEXT[],                                   -- 화이트리스트, NULL=agent 기본값

  -- RAG 범위
  knowledge_scope       JSONB NOT NULL DEFAULT jsonb_build_object(
                          'include_shared', true,
                          'source_types', ARRAY['package','blog','attraction']
                        ),

  -- 가드레일
  guardrails            JSONB NOT NULL DEFAULT jsonb_build_object(
                          'max_discount_pct', 0,
                          'forbidden_phrases', ARRAY[]::text[],
                          'require_hitl_for', ARRAY['refund','custom_discount']
                        ),

  -- 브랜딩
  branding              JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { color, logo_url, avatar_url }

  -- 쿼터 (Phase 5 비용 제어)
  monthly_token_quota   BIGINT NOT NULL DEFAULT 5000000,          -- 500만 토큰/월
  rate_limit_per_min    INTEGER DEFAULT 60,                       -- 분당 요청 수

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_profiles_tenant ON tenant_bot_profiles(tenant_id);

-- ─── jarvis_cost_ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_cost_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL = 플랫폼 내부
  session_id         UUID,
  agent_type         TEXT,
  model              TEXT NOT NULL,

  -- Gemini usageMetadata 매핑
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,                       -- cachedContentTokenCount
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,                       -- 캐시 생성 비용 (있다면)
  thinking_tokens    INTEGER DEFAULT 0,                                -- Gemini 2.5 thinking mode

  cost_usd           NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms         INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_tenant_date
  ON jarvis_cost_ledger(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_session
  ON jarvis_cost_ledger(session_id);

-- ─── 월간 사용량 집계 뷰 ────────────────────────────────────────────
-- 컬럼 변경 대비 DROP 선행 (42P16 회피)
DROP VIEW IF EXISTS jarvis_monthly_usage;

CREATE VIEW jarvis_monthly_usage AS
SELECT
  tenant_id,
  date_trunc('month', created_at) AS month,
  SUM(input_tokens + output_tokens + thinking_tokens)::bigint AS total_tokens,
  SUM(input_tokens)::bigint  AS input_tokens,
  SUM(output_tokens)::bigint AS output_tokens,
  SUM(cache_read_tokens)::bigint AS cache_read_tokens,
  SUM(cost_usd)              AS total_cost_usd,
  COUNT(*)::int              AS call_count,
  COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms,
  COALESCE(MAX(latency_ms), 0)::int AS max_latency_ms
FROM jarvis_cost_ledger
GROUP BY tenant_id, date_trunc('month', created_at);

-- ─── 현재 달 사용량 RPC (쿼터 체크용) ───────────────────────────────
-- 42P13 대비 DROP 선행
DROP FUNCTION IF EXISTS jarvis_current_month_usage(UUID);

CREATE OR REPLACE FUNCTION jarvis_current_month_usage(p_tenant_id UUID)
RETURNS TABLE (total_tokens BIGINT, total_cost_usd NUMERIC, call_count INT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(input_tokens + output_tokens + thinking_tokens), 0)::bigint,
    COALESCE(SUM(cost_usd), 0),
    COUNT(*)::int
  FROM jarvis_cost_ledger
  WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
    AND created_at >= date_trunc('month', now())
$$;

GRANT EXECUTE ON FUNCTION jarvis_current_month_usage TO authenticated, service_role;

COMMENT ON TABLE tenant_bot_profiles IS
  '테넌트별 자비스 봇 설정 (페르소나·가드레일·쿼터). Phase 5 §B.4.1.';
COMMENT ON TABLE jarvis_cost_ledger IS
  '자비스 API 호출 비용 원장. usageMetadata 를 tenant_id 태깅해서 집계. Phase 5 §B.4.3.';
