alter table public.ad_os_automation_runs
  drop constraint if exists ad_os_automation_runs_run_type_check;

alter table public.ad_os_automation_runs
  add constraint ad_os_automation_runs_run_type_check
  check (
    run_type = any (
      array[
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
        'limited_write_pilot',
        'credential_preflight',
        'data_quality_snapshot',
        'google_draft_packet_jobs',
        'naver_live_preflight',
        'ops_queue_action',
        'tenant_audit_export'
      ]::text[]
    )
  );
