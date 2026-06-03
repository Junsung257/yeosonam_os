-- Ad OS V86-V100 execution gate and rollback drill layer.
-- This keeps live spend disabled by default, but makes the last preflight before
-- Naver limited writes explicit, auditable, and reversible.

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
    'rollback_drill'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_adapter_execution_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  packet_id uuid NULL REFERENCES public.ad_os_platform_write_packets(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  gate_status text NOT NULL CHECK (gate_status IN ('eligible', 'blocked', 'monitor_only')),
  requested_mode text NOT NULL CHECK (requested_mode IN ('recommend', 'approve', 'limited_autopilot', 'full_autopilot')),
  allowed_mode text NOT NULL CHECK (allowed_mode IN ('recommend', 'approve', 'limited_autopilot')),
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  budget_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  adapter_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  packet_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action text NOT NULL DEFAULT '',
  external_api_write boolean NOT NULL DEFAULT false,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_adapter_execution_gates_platform
  ON public.ad_os_adapter_execution_gates(platform, gate_status, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_adapter_execution_gates_packet
  ON public.ad_os_adapter_execution_gates(packet_id, evaluated_at DESC)
  WHERE packet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_adapter_execution_gates_tenant
  ON public.ad_os_adapter_execution_gates(tenant_id, platform, evaluated_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_adapter_execution_gates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_adapter_execution_gates_service" ON public.ad_os_adapter_execution_gates;
CREATE POLICY "ad_os_adapter_execution_gates_service"
  ON public.ad_os_adapter_execution_gates
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_rollback_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  packet_id uuid NULL REFERENCES public.ad_os_platform_write_packets(id) ON DELETE SET NULL,
  gate_id uuid NULL REFERENCES public.ad_os_adapter_execution_gates(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  drill_status text NOT NULL CHECK (drill_status IN ('ready', 'blocked', 'not_required')),
  rollback_type text NOT NULL CHECK (rollback_type IN ('pause_keyword', 'delete_draft', 'disable_capi_test', 'manual_review')),
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_reason text NULL,
  external_api_write boolean NOT NULL DEFAULT false,
  drilled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_rollback_drills_platform
  ON public.ad_os_rollback_drills(platform, drill_status, drilled_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_rollback_drills_packet
  ON public.ad_os_rollback_drills(packet_id, drilled_at DESC)
  WHERE packet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_rollback_drills_tenant
  ON public.ad_os_rollback_drills(tenant_id, platform, drilled_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_rollback_drills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_rollback_drills_service" ON public.ad_os_rollback_drills;
CREATE POLICY "ad_os_rollback_drills_service"
  ON public.ad_os_rollback_drills
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_adapter_execution_gates FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_rollback_drills FROM anon, authenticated;
