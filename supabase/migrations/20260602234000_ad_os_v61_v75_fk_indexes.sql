-- Ad OS V61-V75 advisor follow-up indexes.
-- Adds covering indexes for runtime foreign keys used by audit/run drilldowns.

CREATE INDEX IF NOT EXISTS idx_ad_os_runtime_readiness_checks_run
  ON public.ad_os_runtime_readiness_checks(run_id, checked_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_execution_attempts_run
  ON public.ad_os_execution_attempts(run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_platform_jobs_run
  ON public.ad_os_platform_jobs(run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_conversion_upload_jobs_run
  ON public.ad_os_conversion_upload_jobs(run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_tenant_audit_exports_run_lookup
  ON public.ad_os_tenant_audit_exports(period_end DESC, status, created_at DESC);
