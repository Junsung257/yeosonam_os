-- Ad OS change requests V6
-- Approval and rollback queue between AI decisions and any guarded/full automation.

CREATE TABLE IF NOT EXISTS public.ad_os_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  decision_log_id uuid NULL REFERENCES public.ad_os_decision_logs(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao')),
  automation_level integer NOT NULL DEFAULT 2 CHECK (automation_level >= 0 AND automation_level <= 5),
  request_type text NOT NULL CHECK (request_type IN (
    'create_keyword',
    'pause_keyword',
    'increase_bid',
    'decrease_bid',
    'budget_change',
    'pause_channel',
    'replace_landing',
    'create_landing',
    'create_campaign',
    'sync_external_asset'
  )),
  target_table text NOT NULL,
  target_id text NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'approved', 'rejected', 'applied', 'rolled_back', 'expired'
  )),
  title text NOT NULL,
  reason text NOT NULL,
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_required boolean NOT NULL DEFAULT true,
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  applied_at timestamptz NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_change_requests_status
  ON public.ad_os_change_requests(status, risk_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_change_requests_target
  ON public.ad_os_change_requests(target_table, target_id);

CREATE INDEX IF NOT EXISTS idx_ad_os_change_requests_tenant
  ON public.ad_os_change_requests(tenant_id, status)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_change_requests_service" ON public.ad_os_change_requests;
CREATE POLICY "ad_os_change_requests_service"
  ON public.ad_os_change_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
