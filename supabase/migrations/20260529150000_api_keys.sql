-- Yeosonam OS API key issue/verification system (Phase 3-1).

-- 1. API keys.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  rate_limit_per_min INT DEFAULT 60,
  monthly_quota INT,
  monthly_usage INT DEFAULT 0,
  quota_reset_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select ON api_keys;
CREATE POLICY api_keys_select ON api_keys
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM affiliates WHERE id = auth.uid()::uuid)
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS api_keys_insert ON api_keys;
CREATE POLICY api_keys_insert ON api_keys
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS api_keys_update ON api_keys;
CREATE POLICY api_keys_update ON api_keys
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS api_keys_delete ON api_keys;
CREATE POLICY api_keys_delete ON api_keys
  FOR DELETE USING (auth.role() = 'service_role');

-- 2. API key usage log.
CREATE TABLE IF NOT EXISTS api_key_usage (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method TEXT,
  status_code INT,
  latency_ms INT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key ON api_key_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_tenant ON api_key_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created ON api_key_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_month
  ON api_key_usage ((date_trunc('month', created_at AT TIME ZONE 'UTC')));

ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_usage_select ON api_key_usage;
CREATE POLICY api_key_usage_select ON api_key_usage
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM affiliates WHERE id = auth.uid()::uuid)
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS api_key_usage_insert ON api_key_usage;
CREATE POLICY api_key_usage_insert ON api_key_usage
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 3. Monthly usage increment RPC.
CREATE OR REPLACE FUNCTION increment_api_key_usage(p_key_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE api_keys
  SET monthly_usage = monthly_usage + 1
  WHERE id = p_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
