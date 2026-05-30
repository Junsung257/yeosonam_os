-- 여소남 OS — API 키 발급/검증 시스템 (Phase 3-1)

-- 1. api_keys 테이블
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                        -- 키 식별명 (예: "프로덕션 API 키")
  key_hash TEXT NOT NULL UNIQUE,             -- sha256(prefix + secret) 저장
  key_prefix TEXT NOT NULL,                  -- 앞 8자 (식별용, e.g. 'ysn_live_')
  scopes TEXT[] DEFAULT '{}',               -- e.g. {'qa:chat', 'qa:read', 'booking:write'}
  rate_limit_per_min INT DEFAULT 60,         -- 분당 최대 요청
  monthly_quota INT,                         -- 월간 최대 요청 (null = 무제한)
  monthly_usage INT DEFAULT 0,               -- 이번 달 사용량
  quota_reset_at TIMESTAMPTZ,               -- monthly_usage 리셋 시각
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                    -- null = 만료 없음
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 자신의 tenant 키만 조회 가능
CREATE POLICY api_keys_select ON api_keys
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM affiliates WHERE id = auth.uid()::uuid)
    OR auth.role() = 'service_role'
  );

-- 서비스 롤만 INSERT/UPDATE/DELETE
CREATE POLICY api_keys_insert ON api_keys
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY api_keys_update ON api_keys
  FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY api_keys_delete ON api_keys
  FOR DELETE USING (auth.role() = 'service_role');

-- 2. API 키 사용량 로그
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

-- 파티셔닝 준비 (월별)
CREATE INDEX IF NOT EXISTS idx_api_key_usage_month ON api_key_usage((date_trunc('month', created_at)));

-- RLS
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_key_usage_select ON api_key_usage
  FOR SELECT USING (
    tenant_id IN (SELECT id FROM affiliates WHERE id = auth.uid()::uuid)
    OR auth.role() = 'service_role'
  );
CREATE POLICY api_key_usage_insert ON api_key_usage
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 3. monthly_usage 증가용 RPC
CREATE OR REPLACE FUNCTION increment_api_key_usage(p_key_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE api_keys
  SET monthly_usage = monthly_usage + 1
  WHERE id = p_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
