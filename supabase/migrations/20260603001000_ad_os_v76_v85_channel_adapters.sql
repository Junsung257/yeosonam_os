-- Ad OS V76-V85 channel adapter readiness and guarded write packets.
-- These tables record platform-adapter readiness and executable packets while
-- keeping live external spend disabled by default.

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
    'platform_write_packet'
  ));

CREATE TABLE IF NOT EXISTS public.ad_os_channel_adapter_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  adapter_state text NOT NULL CHECK (adapter_state IN (
    'missing_credentials',
    'permission_denied',
    'no_campaign',
    'draft_ready',
    'paused_write_ready',
    'live_write_blocked',
    'executable',
    'blocked'
  )),
  capability_level integer NOT NULL DEFAULT 0 CHECK (capability_level >= 0 AND capability_level <= 5),
  credentials_ready boolean NOT NULL DEFAULT false,
  permission_ready boolean NOT NULL DEFAULT false,
  campaign_ready boolean NOT NULL DEFAULT false,
  budget_ready boolean NOT NULL DEFAULT false,
  conversion_ready boolean NOT NULL DEFAULT false,
  live_publish_enabled boolean NOT NULL DEFAULT false,
  external_api_write boolean NOT NULL DEFAULT false,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_channel_adapter_health_platform
  ON public.ad_os_channel_adapter_health(platform, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_channel_adapter_health_tenant
  ON public.ad_os_channel_adapter_health(tenant_id, platform, checked_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_channel_adapter_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_channel_adapter_health_service" ON public.ad_os_channel_adapter_health;
CREATE POLICY "ad_os_channel_adapter_health_service"
  ON public.ad_os_channel_adapter_health
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_platform_write_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  packet_type text NOT NULL CHECK (packet_type IN (
    'naver_paused_keyword',
    'google_campaign_draft',
    'google_conversion_action_check',
    'meta_capi_test_event',
    'meta_creative_seed',
    'kakao_draft'
  )),
  lifecycle_status text NOT NULL DEFAULT 'planned' CHECK (lifecycle_status IN (
    'planned',
    'ready',
    'blocked',
    'queued',
    'succeeded',
    'failed',
    'archived'
  )),
  job_id uuid NULL REFERENCES public.ad_os_platform_jobs(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  external_api_write boolean NOT NULL DEFAULT false,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrail_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_reason text NULL,
  rollback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_os_platform_write_packets_platform
  ON public.ad_os_platform_write_packets(platform, lifecycle_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_platform_write_packets_tenant
  ON public.ad_os_platform_write_packets(tenant_id, platform, lifecycle_status, created_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_platform_write_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_platform_write_packets_service" ON public.ad_os_platform_write_packets;
CREATE POLICY "ad_os_platform_write_packets_service"
  ON public.ad_os_platform_write_packets
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_channel_adapter_health FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_platform_write_packets FROM anon, authenticated;
