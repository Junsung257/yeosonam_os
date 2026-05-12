-- tenant_oauth_tokens: 테넌트별 외부 플랫폼 OAuth 토큰 저장
-- 토큰은 encrypt() 함수로 암호화 후 저장 (src/lib/encryption.ts)

CREATE TABLE IF NOT EXISTS tenant_oauth_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform        text        NOT NULL CHECK (platform IN ('google_ads', 'meta', 'naver')),
  access_token_enc  text      NOT NULL,
  refresh_token_enc text,
  scopes          text[],
  expires_at      timestamptz,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  connected_by    text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform)
);

ALTER TABLE tenant_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- 관리자(service_role)만 직접 접근; 앱은 supabaseAdmin(service key)으로만 조회
CREATE POLICY "service_role_all" ON tenant_oauth_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_tenant_oauth_tokens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_oauth_tokens_updated_at
  BEFORE UPDATE ON tenant_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION update_tenant_oauth_tokens_updated_at();

COMMENT ON TABLE tenant_oauth_tokens IS '테넌트별 외부 플랫폼(Google Ads, Meta, Naver) OAuth 토큰. 암호화 필수.';
