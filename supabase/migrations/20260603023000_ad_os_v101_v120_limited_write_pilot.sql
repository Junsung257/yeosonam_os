-- Ad OS V101-V120 Naver limited write pilot.
-- This layer promotes the channel adapter packets/gates/rollback drills into a
-- pilot-control ledger while keeping live external writes disabled by default.

ALTER TABLE public.ad_os_automation_runs
  DROP CONSTRAINT IF EXISTS ad_os_automation_runs_run_type_check,
  ADD CONSTRAINT ad_os_automation_runs_run_type_check
  CHECK (run_type IN (
    'analysis',
    'candidate_generation',
    'budget_pacing',
    'bid_optimization',
    'search_term_harvest',
    'expiry_cleanup',
    'full_autopilot',
    'visibility_check',
    'performance_sync',
    'learning_apply',
    'external_publish',
    'publisher_probe',
    'experiment_plan',
    'tenant_report',
    'conversion_ingest',
    'creative_draft',
    'keyword_brain',
    'external_asset_plan',
    'platform_job',
    'conversion_upload',
    'conversion_upload_execute',
    'portfolio_plan',
    'data_quality',
    'creative_asset_group',
    'tenant_workspace',
    'runtime_readiness',
    'platform_job_execute',
    'experiment_standardize',
    'channel_adapter_health',
    'platform_write_packet',
    'adapter_execution_gate',
    'rollback_drill',
    'limited_write_pilot'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_limited_write_pilot_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL DEFAULT 'naver' CHECK (platform IN ('naver')),
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'blocked')),
  pilot_level text NOT NULL DEFAULT 'dry_run_only' CHECK (pilot_level IN ('dry_run_only', 'live_paused_write')),
  monthly_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_cap_krw >= 0),
  daily_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_budget_cap_krw >= 0),
  max_cpc_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_krw >= 0),
  max_test_loss_krw integer NOT NULL DEFAULT 0 CHECK (max_test_loss_krw >= 0),
  require_gate_eligible boolean NOT NULL DEFAULT true,
  require_rollback_ready boolean NOT NULL DEFAULT true,
  require_human_approval boolean NOT NULL DEFAULT true,
  live_external_write_enabled boolean NOT NULL DEFAULT false,
  env_flag_required text NOT NULL DEFAULT 'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
  notes text NULL,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_os_limited_write_pilot_policy_global
  ON public.ad_os_limited_write_pilot_policies(platform)
  WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_limited_write_pilot_policies_tenant
  ON public.ad_os_limited_write_pilot_policies(tenant_id, platform, status, updated_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_limited_write_pilot_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_limited_write_pilot_policies_service" ON public.ad_os_limited_write_pilot_policies;
CREATE POLICY "ad_os_limited_write_pilot_policies_service"
  ON public.ad_os_limited_write_pilot_policies
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_limited_write_pilot_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL DEFAULT 'naver' CHECK (platform IN ('naver')),
  policy_id uuid NULL REFERENCES public.ad_os_limited_write_pilot_policies(id) ON DELETE SET NULL,
  packet_id uuid NULL REFERENCES public.ad_os_platform_write_packets(id) ON DELETE SET NULL,
  gate_id uuid NULL REFERENCES public.ad_os_adapter_execution_gates(id) ON DELETE SET NULL,
  rollback_drill_id uuid NULL REFERENCES public.ad_os_rollback_drills(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  requested_mode text NOT NULL DEFAULT 'dry_run' CHECK (requested_mode IN ('dry_run', 'live_paused_write')),
  attempt_status text NOT NULL CHECK (attempt_status IN (
    'planned',
    'ready',
    'blocked',
    'dry_run_succeeded',
    'live_write_blocked',
    'failed'
  )),
  external_api_write boolean NOT NULL DEFAULT false,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  packet_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_limited_write_pilot_attempts_platform
  ON public.ad_os_limited_write_pilot_attempts(platform, attempt_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_limited_write_pilot_attempts_tenant
  ON public.ad_os_limited_write_pilot_attempts(tenant_id, platform, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_limited_write_pilot_attempts_packet
  ON public.ad_os_limited_write_pilot_attempts(packet_id, created_at DESC)
  WHERE packet_id IS NOT NULL;

ALTER TABLE public.ad_os_limited_write_pilot_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_limited_write_pilot_attempts_service" ON public.ad_os_limited_write_pilot_attempts;
CREATE POLICY "ad_os_limited_write_pilot_attempts_service"
  ON public.ad_os_limited_write_pilot_attempts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_limited_write_pilot_policies FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_limited_write_pilot_attempts FROM anon, authenticated;
