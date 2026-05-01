-- Instagram Accounts (테넌트별 다중 IG 계정)
-- 테넌트가 자신의 IG 계정으로 카드뉴스를 발행할 수 있도록 계정 정보 저장.
-- access_token은 앱 서버에서 encrypt() 처리 후 저장 (서비스 레이어 책임).

CREATE TABLE IF NOT EXISTS instagram_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ig_user_id       TEXT NOT NULL,
  display_name     TEXT,
  access_token     TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  daily_quota_used INT NOT NULL DEFAULT 0,
  quota_reset_at   TIMESTAMPTZ,
  last_published_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ig_accounts_tenant
  ON instagram_accounts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ig_accounts_active
  ON instagram_accounts(tenant_id, is_active)
  WHERE is_active = true;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_instagram_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ig_accounts_updated_at ON instagram_accounts;
CREATE TRIGGER trg_ig_accounts_updated_at
  BEFORE UPDATE ON instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION update_instagram_accounts_updated_at();

-- RLS
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON instagram_accounts;
CREATE POLICY "service_role_all" ON instagram_accounts
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
