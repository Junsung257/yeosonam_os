-- Sprint 4-B: SaaS 빌링 — TossPayments 자동결제 연동

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  plan_type           TEXT NOT NULL DEFAULT 'free'
                        CHECK (plan_type IN ('free', 'starter', 'growth', 'enterprise')),
  toss_billing_key    TEXT,              -- TossPayments 자동결제 빌링키 (암호화)
  toss_customer_key   TEXT UNIQUE,       -- TossPayments 고객키 (UUID v4 권장)
  monthly_price_krw   INTEGER,
  content_quota       INTEGER NOT NULL DEFAULT 10,  -- 월 콘텐츠 생성 한도
  next_billing_date   DATE,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'cancelled', 'past_due')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE SET NULL,
  toss_payment_key TEXT,
  amount_krw       INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('done', 'failed', 'cancelled')),
  failure_message  TEXT,
  billed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_monthly_usage (
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE,
  month              DATE NOT NULL,  -- 월의 첫날 (2026-05-01 형식)
  content_generated  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON tenant_subscriptions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_billing ON tenant_subscriptions(next_billing_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_billing_history_tenant ON billing_history(tenant_id, billed_at DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_month ON tenant_monthly_usage(month);

-- RLS
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_monthly_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_subscriptions" ON tenant_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_denied_subscriptions" ON tenant_subscriptions
  FOR ALL TO anon USING (false);

CREATE POLICY "service_role_full_billing_history" ON billing_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_denied_billing_history" ON billing_history
  FOR ALL TO anon USING (false);

CREATE POLICY "service_role_full_monthly_usage" ON tenant_monthly_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_denied_monthly_usage" ON tenant_monthly_usage
  FOR ALL TO anon USING (false);
