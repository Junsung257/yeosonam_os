-- 여소남 OS — Toss Payments Billing 연동 (Phase 3-3)
-- API 키, 테넌트 결제 설정, billing_history

-- 1. billing_settings: 테넌트별 결제 설정
CREATE TABLE IF NOT EXISTS billing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE UNIQUE,
  toss_secret_api_key TEXT NOT NULL,          -- Toss Payments 시크릿 키 (암호화 권장)
  toss_client_api_key TEXT,                   -- 클라이언트 SDK용 (공개 가능)
  plan_type TEXT DEFAULT 'pay_as_you_go' CHECK (plan_type IN ('free', 'pay_as_you_go', 'monthly', 'annual')),
  base_fee NUMERIC DEFAULT 0,                -- 월 기본 요금 (원)
  overage_unit_price NUMERIC DEFAULT 0,      -- 초과 건당 단가
  billing_day INT DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE billing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_settings_select ON billing_settings
  FOR SELECT USING (auth.role() IN ('service_role', 'authenticated'));
CREATE POLICY billing_settings_insert ON billing_settings
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY billing_settings_update ON billing_settings
  FOR UPDATE USING (auth.role() = 'service_role');

-- 2. billing_invoices: 월별 청구서
CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  base_fee NUMERIC NOT NULL DEFAULT 0,
  overage_count INT NOT NULL DEFAULT 0,
  overage_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  toss_payment_key TEXT,                     -- Toss 결제 키 (결제 완료 시)
  toss_order_id TEXT,                        -- Toss 주문 ID
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON billing_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status ON billing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_period ON billing_invoices(period_year, period_month);

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_invoices_select ON billing_invoices
  FOR SELECT USING (auth.role() IN ('service_role', 'authenticated'));
CREATE POLICY billing_invoices_insert ON billing_invoices
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY billing_invoices_update ON billing_invoices
  FOR UPDATE USING (auth.role() = 'service_role');

-- 3. billing_history: 결제/청구 이벤트 로그
CREATE TABLE IF NOT EXISTS billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'invoice_created', 'payment_succeeded', 'payment_failed',
    'plan_changed', 'overage_charge', 'refund', 'credit_applied'
  )),
  invoice_id UUID REFERENCES billing_invoices(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'KRW',
  description TEXT,
  toss_transaction_key TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_history_tenant ON billing_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_history_created ON billing_history(created_at DESC);

ALTER TABLE billing_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_history_select ON billing_history
  FOR SELECT USING (auth.role() IN ('service_role', 'authenticated'));
CREATE POLICY billing_history_insert ON billing_history
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
