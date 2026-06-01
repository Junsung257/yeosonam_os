-- Ad OS tenant ad accounts V5
-- SaaS-ready external account registry. Secrets stay in server-side vault/env;
-- this table stores account ids, permission state, and operational ownership.

CREATE TABLE IF NOT EXISTS public.ad_os_tenant_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  account_mode text NOT NULL DEFAULT 'agency_managed' CHECK (account_mode IN ('agency_managed', 'tenant_owned', 'hybrid')),
  external_account_id text NULL,
  external_customer_id text NULL,
  external_campaign_id text NULL,
  external_ad_group_id text NULL,
  connection_status text NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN (
    'not_connected', 'credentials_ready', 'permission_denied', 'no_campaign', 'ready', 'suspended'
  )),
  permission_scope text[] NOT NULL DEFAULT '{}'::text[],
  monthly_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_cap_krw >= 0),
  daily_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_budget_cap_krw >= 0),
  can_publish_keywords boolean NOT NULL DEFAULT false,
  can_change_bids boolean NOT NULL DEFAULT false,
  can_pause_assets boolean NOT NULL DEFAULT false,
  last_probe_at timestamptz NULL,
  last_probe_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_status text NOT NULL DEFAULT 'watch' CHECK (risk_status IN ('normal', 'watch', 'restricted', 'blocked')),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, account_mode)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_tenant_ad_accounts_global
  ON public.ad_os_tenant_ad_accounts((tenant_id IS NULL), platform, account_mode)
  WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_tenant_ad_accounts_status
  ON public.ad_os_tenant_ad_accounts(connection_status, platform);

ALTER TABLE public.ad_os_tenant_ad_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_tenant_ad_accounts_service" ON public.ad_os_tenant_ad_accounts;
CREATE POLICY "ad_os_tenant_ad_accounts_service"
  ON public.ad_os_tenant_ad_accounts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ad_os_channel_budgets
  ADD COLUMN IF NOT EXISTS tenant_ad_account_id uuid NULL REFERENCES public.ad_os_tenant_ad_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_channel_budgets_tenant_ad_account
  ON public.ad_os_channel_budgets(tenant_ad_account_id)
  WHERE tenant_ad_account_id IS NOT NULL;
