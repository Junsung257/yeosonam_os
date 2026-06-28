-- Ad OS AI Director foundation.
-- Adds durable score, source, budget-allocation, and MCP audit ledgers.
-- External platform writes remain impossible from these tables.

CREATE TABLE IF NOT EXISTS public.ad_os_source_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL UNIQUE,
  source_title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'official_docs',
    'release_notes',
    'open_source',
    'research',
    'runbook'
  )),
  publisher text NOT NULL DEFAULT 'unknown',
  channel text NOT NULL CHECK (channel IN (
    'google',
    'meta',
    'naver',
    'kakao',
    'seo',
    'mcp',
    'cross_channel'
  )),
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('accepted', 'backlog', 'rejected')),
  accepted_capability text NOT NULL DEFAULT '',
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  reviewed_at timestamptz NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_source_ledger_channel
  ON public.ad_os_source_ledger(channel, status, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_os_section_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  tenant_id uuid NULL,
  section_key text NOT NULL,
  section_label text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  status text NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_section_scores_latest
  ON public.ad_os_section_scores(section_key, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_section_scores_tenant
  ON public.ad_os_section_scores(tenant_id, section_key, generated_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_os_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  allocation_pct numeric NOT NULL DEFAULT 0 CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
  monthly_cap_krw integer NOT NULL DEFAULT 0 CHECK (monthly_cap_krw >= 0),
  daily_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_cap_krw >= 0),
  max_cpc_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_krw >= 0),
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('planned', 'blocked', 'applied', 'archived')),
  rationale text NOT NULL DEFAULT '',
  guardrail_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_budget_allocations_run
  ON public.ad_os_budget_allocations(run_id, platform);

CREATE INDEX IF NOT EXISTS idx_ad_os_budget_allocations_tenant
  ON public.ad_os_budget_allocations(tenant_id, platform, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_os_mcp_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  tool_name text NOT NULL,
  mode text NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only')),
  request_summary text NOT NULL DEFAULT '',
  response_summary text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('allowed', 'blocked', 'failed')),
  safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_mcp_tool_calls_provider
  ON public.ad_os_mcp_tool_calls(provider, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_mcp_tool_calls_run
  ON public.ad_os_mcp_tool_calls(run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.ad_os_source_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_os_section_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_os_budget_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_os_mcp_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_source_ledger_service" ON public.ad_os_source_ledger;
CREATE POLICY "ad_os_source_ledger_service"
  ON public.ad_os_source_ledger
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ad_os_section_scores_service" ON public.ad_os_section_scores;
CREATE POLICY "ad_os_section_scores_service"
  ON public.ad_os_section_scores
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ad_os_budget_allocations_service" ON public.ad_os_budget_allocations;
CREATE POLICY "ad_os_budget_allocations_service"
  ON public.ad_os_budget_allocations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ad_os_mcp_tool_calls_service" ON public.ad_os_mcp_tool_calls;
CREATE POLICY "ad_os_mcp_tool_calls_service"
  ON public.ad_os_mcp_tool_calls
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_source_ledger FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_section_scores FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_budget_allocations FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_mcp_tool_calls FROM anon, authenticated;
