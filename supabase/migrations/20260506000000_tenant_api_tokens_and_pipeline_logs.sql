-- ─────────────────────────────────────────────────────────────────────────────
-- Session 2/3: 멀티테넌트 OAuth 토큰 저장소 + 마케팅 파이프라인 로그
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenant_api_tokens ──────────────────────────────────────────────────────
-- 테넌트별 암호화된 OAuth 토큰 (Google Ads, Meta, Naver 등)
-- encrypted_* 컬럼은 src/lib/encryption.ts의 AES-256-GCM 형식: "iv:authTag:ciphertext"

CREATE TABLE IF NOT EXISTS tenant_api_tokens (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                text        NOT NULL
    CHECK (provider IN ('google_ads', 'meta', 'naver', 'google_analytics')),
  encrypted_access_token  text        NOT NULL,
  encrypted_refresh_token text,
  expires_at              timestamptz,
  scopes                  text[]      NOT NULL DEFAULT '{}',
  is_active               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

-- 활성 토큰 빠른 조회용 (token-resolver.ts에서 사용)
CREATE INDEX IF NOT EXISTS idx_tat_tenant_provider
  ON tenant_api_tokens (tenant_id, provider)
  WHERE is_active = true;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_tenant_api_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_api_tokens_updated_at ON tenant_api_tokens;
CREATE TRIGGER trg_tenant_api_tokens_updated_at
  BEFORE UPDATE ON tenant_api_tokens
  FOR EACH ROW EXECUTE FUNCTION update_tenant_api_tokens_updated_at();

-- RLS: supabaseAdmin(서비스롤)으로만 접근 — Row Level Security 비활성화
ALTER TABLE tenant_api_tokens DISABLE ROW LEVEL SECURITY;

-- ── 2. pipeline_logs ──────────────────────────────────────────────────────────
-- 매일 마케팅 파이프라인 실행 로그
-- agents_run JSONB 구조:
--   { "content": { "ok": true, "items": 3, "elapsed_ms": 1200 },
--     "ad":      { "ok": false, "error": "Meta 토큰 만료", "elapsed_ms": 300 },
--     "engagement": { "ok": true, "skipped": true, "skip_reason": "Resend 미설정" }, ... }

CREATE TABLE IF NOT EXISTS pipeline_logs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  run_date      date        NOT NULL DEFAULT CURRENT_DATE,
  status        text        NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  agents_run    jsonb       NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  error_message text
);

-- 테넌트별 날짜 조회용 (ReportingAgent에서 사용)
CREATE INDEX IF NOT EXISTS idx_pl_tenant_date
  ON pipeline_logs (tenant_id, run_date DESC);

-- 상태별 집계용
CREATE INDEX IF NOT EXISTS idx_pl_status
  ON pipeline_logs (status)
  WHERE status IN ('running', 'failed');

-- RLS 비활성화 (서비스롤 전용)
ALTER TABLE pipeline_logs DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE tenant_api_tokens IS '테넌트별 암호화된 OAuth 토큰. AES-256-GCM 암호화 필수.';
COMMENT ON TABLE pipeline_logs     IS '마케팅 자동화 파이프라인 일별 실행 로그. agents_run JSONB에 에이전트별 결과.';
