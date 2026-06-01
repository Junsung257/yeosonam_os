-- Ad OS tenant governance
-- SaaS-ready guardrails for tenant budgets, platform permissions, and automation risk.

CREATE TABLE IF NOT EXISTS public.ad_os_tenant_governance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  allowed_platforms text[] NOT NULL DEFAULT ARRAY['naver', 'google']::text[]
    CHECK (allowed_platforms <@ ARRAY['naver', 'google', 'meta', 'kakao']::text[]),
  monthly_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_cap_krw >= 0),
  daily_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_budget_cap_krw >= 0),
  max_cpc_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_krw >= 0),
  max_test_loss_krw integer NOT NULL DEFAULT 0 CHECK (max_test_loss_krw >= 0),
  max_automation_level integer NOT NULL DEFAULT 2 CHECK (max_automation_level >= 0 AND max_automation_level <= 5),
  require_human_approval boolean NOT NULL DEFAULT true,
  full_auto_enabled boolean NOT NULL DEFAULT false,
  risk_status text NOT NULL DEFAULT 'normal' CHECK (risk_status IN ('normal', 'watch', 'restricted', 'blocked')),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_tenant_governance_tenant
  ON public.ad_os_tenant_governance(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_tenant_governance_global
  ON public.ad_os_tenant_governance((tenant_id IS NULL))
  WHERE tenant_id IS NULL;

ALTER TABLE public.ad_os_tenant_governance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_tenant_governance_service" ON public.ad_os_tenant_governance;
CREATE POLICY "ad_os_tenant_governance_service"
  ON public.ad_os_tenant_governance
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ad_os_channel_budgets
  ADD COLUMN IF NOT EXISTS tenant_governance_id uuid NULL REFERENCES public.ad_os_tenant_governance(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_channel_budgets_tenant_governance
  ON public.ad_os_channel_budgets(tenant_governance_id)
  WHERE tenant_governance_id IS NOT NULL;
