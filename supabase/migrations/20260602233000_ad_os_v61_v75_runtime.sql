-- Ad OS V61-V75 runtime readiness and guarded execution layer.
-- Keeps live spend disabled by default while allowing staging to verify queue,
-- conversion upload, experiment, rollback, and tenant audit cycles.

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
    'portfolio_plan',
    'data_quality',
    'creative_asset_group',
    'tenant_workspace',
    'runtime_readiness',
    'platform_job_execute',
    'conversion_upload_execute',
    'experiment_standardize',
    'tenant_audit_export'
  ));

ALTER TABLE public.tenant_ad_workspaces
  ADD COLUMN IF NOT EXISTS approver_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS operator_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS forbidden_keywords text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS data_retention_days integer NOT NULL DEFAULT 730 CHECK (data_retention_days >= 30),
  ADD COLUMN IF NOT EXISTS audit_export_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.ad_os_conversion_upload_jobs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS freshness_status text NOT NULL DEFAULT 'fresh' CHECK (freshness_status IN ('fresh', 'stale', 'expired')),
  ADD COLUMN IF NOT EXISTS dedupe_status text NOT NULL DEFAULT 'unique' CHECK (dedupe_status IN ('unique', 'duplicate', 'collision'));

CREATE TABLE IF NOT EXISTS public.ad_os_runtime_readiness_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  check_key text NOT NULL,
  surface text NOT NULL DEFAULT 'ad_os',
  status text NOT NULL DEFAULT 'warn' CHECK (status IN ('pass', 'warn', 'fail', 'blocked')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_action text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_runtime_readiness_checks_status
  ON public.ad_os_runtime_readiness_checks(status, severity, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_os_runtime_readiness_checks_tenant
  ON public.ad_os_runtime_readiness_checks(tenant_id, checked_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_runtime_readiness_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_runtime_readiness_checks_service" ON public.ad_os_runtime_readiness_checks;
CREATE POLICY "ad_os_runtime_readiness_checks_service"
  ON public.ad_os_runtime_readiness_checks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao')),
  job_id uuid NULL REFERENCES public.ad_os_platform_jobs(id) ON DELETE SET NULL,
  conversion_upload_job_id uuid NULL REFERENCES public.ad_os_conversion_upload_jobs(id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES public.ad_os_automation_runs(id) ON DELETE SET NULL,
  attempt_type text NOT NULL CHECK (attempt_type IN ('platform_job', 'conversion_upload', 'rollback')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'succeeded', 'failed', 'blocked')),
  dry_run boolean NOT NULL DEFAULT true,
  external_api_write boolean NOT NULL DEFAULT false,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_reason text NULL,
  retryable boolean NOT NULL DEFAULT false,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_execution_attempts_job
  ON public.ad_os_execution_attempts(job_id, status, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_execution_attempts_upload_job
  ON public.ad_os_execution_attempts(conversion_upload_job_id, status, created_at DESC)
  WHERE conversion_upload_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_execution_attempts_status
  ON public.ad_os_execution_attempts(attempt_type, status, created_at DESC);

ALTER TABLE public.ad_os_execution_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_execution_attempts_service" ON public.ad_os_execution_attempts;
CREATE POLICY "ad_os_execution_attempts_service"
  ON public.ad_os_execution_attempts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_experiment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  template_key text NOT NULL,
  experiment_type text NOT NULL CHECK (experiment_type IN ('holdout', 'date_split', 'landing_ab', 'creative_ab', 'match_type_ab')),
  primary_metric text NOT NULL DEFAULT 'margin_roas',
  minimum_clicks integer NOT NULL DEFAULT 100 CHECK (minimum_clicks >= 0),
  minimum_conversions integer NOT NULL DEFAULT 3 CHECK (minimum_conversions >= 0),
  minimum_days integer NOT NULL DEFAULT 7 CHECK (minimum_days >= 1),
  confidence_threshold numeric NOT NULL DEFAULT 0.8 CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  automation_level_required integer NOT NULL DEFAULT 2 CHECK (automation_level_required >= 0 AND automation_level_required <= 5),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_experiment_templates_global
  ON public.ad_os_experiment_templates(template_key)
  WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_experiment_templates_type
  ON public.ad_os_experiment_templates(experiment_type, status, created_at DESC);

ALTER TABLE public.ad_os_experiment_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_experiment_templates_service" ON public.ad_os_experiment_templates;
CREATE POLICY "ad_os_experiment_templates_service"
  ON public.ad_os_experiment_templates
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ad_os_tenant_audit_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  workspace_id uuid NULL REFERENCES public.tenant_ad_workspaces(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'sent', 'archived')),
  export_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_tenant_audit_exports_tenant
  ON public.ad_os_tenant_audit_exports(tenant_id, period_end DESC, status);

CREATE INDEX IF NOT EXISTS idx_ad_os_tenant_audit_exports_workspace
  ON public.ad_os_tenant_audit_exports(workspace_id, period_end DESC)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE public.ad_os_tenant_audit_exports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_tenant_audit_exports_service" ON public.ad_os_tenant_audit_exports;
CREATE POLICY "ad_os_tenant_audit_exports_service"
  ON public.ad_os_tenant_audit_exports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_runtime_readiness_checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_execution_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_experiment_templates FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_os_tenant_audit_exports FROM anon, authenticated;
