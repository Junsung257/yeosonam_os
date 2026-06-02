import type { PlatformJobStatus } from './ad-os-v41-v60';

type JsonRecord = Record<string, unknown>;

export type RuntimeReadinessStatus = 'pass' | 'warn' | 'fail' | 'blocked';
export type RuntimeReadinessSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type RuntimeReadinessCheckRow = {
  tenant_id: string | null;
  run_id?: string | null;
  check_key: string;
  surface: string;
  status: RuntimeReadinessStatus;
  severity: RuntimeReadinessSeverity;
  evidence: JsonRecord;
  next_action: string;
  checked_at?: string;
};

export type RuntimeReadinessInput = {
  tenantId?: string | null;
  tables: Record<string, boolean>;
  apiJson: Record<string, boolean>;
  counts: Record<string, number>;
  fullAutoEnabled: number;
  externalApiWrites: number;
};

export type PlatformExecutionJob = {
  id: string;
  tenant_id?: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  job_type: string;
  status: PlatformJobStatus;
  automation_level?: number | null;
  request_payload?: JsonRecord | null;
  response_payload?: JsonRecord | null;
  blocked_reason?: string | null;
  external_api_write?: boolean | null;
  idempotency_key?: string | null;
};

export type PlatformExecutionMode = 'dry_run' | 'paused_only' | 'active_allowed';

export type ExecutionAttemptRow = {
  tenant_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao' | null;
  job_id?: string | null;
  conversion_upload_job_id?: string | null;
  run_id?: string | null;
  attempt_type: 'platform_job' | 'conversion_upload' | 'rollback';
  status: 'planned' | 'running' | 'succeeded' | 'failed' | 'blocked';
  dry_run: boolean;
  external_api_write: boolean;
  request_payload: JsonRecord;
  response_payload: JsonRecord;
  blocked_reason: string | null;
  retryable: boolean;
  started_at?: string | null;
  finished_at?: string | null;
};

export type PlatformExecutionDecision = {
  attempt: ExecutionAttemptRow;
  jobPatch: {
    status: PlatformJobStatus;
    guardrail_status?: 'passed' | 'blocked';
    response_payload?: JsonRecord;
    blocked_reason?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    external_api_write?: boolean;
  };
};

export type ConversionUploadRuntimeJob = {
  id: string;
  tenant_id?: string | null;
  platform: 'google' | 'meta';
  status: 'planned' | 'approved' | 'running' | 'uploaded' | 'failed' | 'blocked';
  event_name?: string | null;
  event_time?: string | null;
  consent_status?: 'granted' | 'denied' | 'unknown' | null;
  signal_quality_score?: number | null;
  blocked_reason?: string | null;
  idempotency_key?: string | null;
  identifiers?: JsonRecord | null;
  upload_payload?: JsonRecord | null;
  freshness_status?: 'fresh' | 'stale' | 'expired' | null;
  dedupe_status?: 'unique' | 'duplicate' | 'collision' | null;
  retry_count?: number | null;
};

export type ConversionExecutionDecision = {
  attempt: ExecutionAttemptRow;
  jobPatch: {
    status: 'planned' | 'approved' | 'running' | 'uploaded' | 'failed' | 'blocked';
    response_payload?: JsonRecord;
    blocked_reason?: string | null;
    external_upload_id?: string | null;
    uploaded_at?: string | null;
    freshness_status?: 'fresh' | 'stale' | 'expired';
    dedupe_status?: 'unique' | 'duplicate' | 'collision';
    retry_count?: number;
    next_retry_at?: string | null;
  };
};

export type ExperimentTemplateRow = {
  tenant_id: string | null;
  template_key: string;
  experiment_type: 'holdout' | 'date_split' | 'landing_ab' | 'creative_ab' | 'match_type_ab';
  primary_metric: 'margin_roas';
  minimum_clicks: number;
  minimum_conversions: number;
  minimum_days: number;
  confidence_threshold: number;
  automation_level_required: number;
  status: 'active';
  config: JsonRecord;
};

export type TenantWorkspaceForExport = {
  id: string;
  tenant_id?: string | null;
  workspace_name?: string | null;
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  channel_budget_caps?: JsonRecord | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  automation_level?: number | null;
  require_human_approval?: boolean | null;
  full_auto_enabled?: boolean | null;
  forbidden_keywords?: string[] | null;
  data_retention_days?: number | null;
  audit_export_enabled?: boolean | null;
  risk_status?: string | null;
};

export type TenantAuditExportRow = {
  tenant_id: string | null;
  workspace_id: string | null;
  period_start: string;
  period_end: string;
  status: 'draft' | 'ready';
  export_payload: JsonRecord;
  report_payload: JsonRecord;
};

function nowIso(): string {
  return new Date().toISOString();
}

function daysOld(value?: string | null, now = new Date()): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

function check(input: Omit<RuntimeReadinessCheckRow, 'surface' | 'tenant_id'> & { tenant_id?: string | null; surface?: string }): RuntimeReadinessCheckRow {
  return {
    tenant_id: input.tenant_id ?? null,
    surface: input.surface || 'ad_os',
    run_id: input.run_id,
    check_key: input.check_key,
    status: input.status,
    severity: input.severity,
    evidence: input.evidence,
    next_action: input.next_action,
    checked_at: input.checked_at || nowIso(),
  };
}

export function buildRuntimeReadinessChecks(input: RuntimeReadinessInput): RuntimeReadinessCheckRow[] {
  const tenantId = input.tenantId ?? null;
  const requiredTables = [
    'ad_os_platform_jobs',
    'ad_os_conversion_upload_jobs',
    'ad_os_data_quality_snapshots',
    'ad_os_portfolio_budget_plans',
    'ad_os_creative_asset_variants',
    'ad_os_travel_intent_signals',
    'ad_os_tenant_billing_profiles',
    'ad_os_runtime_readiness_checks',
    'ad_os_execution_attempts',
    'ad_os_experiment_templates',
    'ad_os_tenant_audit_exports',
  ];
  const missingTables = requiredTables.filter((table) => !input.tables[table]);
  const apiFailures = Object.entries(input.apiJson).filter(([, ok]) => !ok).map(([route]) => route);

  return [
    check({
      tenant_id: tenantId,
      check_key: 'migration_tables',
      status: missingTables.length === 0 ? 'pass' : 'blocked',
      severity: missingTables.length === 0 ? 'info' : 'critical',
      evidence: { required_tables: requiredTables, missing_tables: missingTables },
      next_action: missingTables.length === 0 ? '마이그레이션 테이블 준비 완료' : 'V41-V75 migration을 운영 Supabase에 적용',
    }),
    check({
      tenant_id: tenantId,
      check_key: 'admin_api_json',
      status: apiFailures.length === 0 ? 'pass' : 'fail',
      severity: apiFailures.length === 0 ? 'info' : 'high',
      evidence: { routes: input.apiJson, failures: apiFailures },
      next_action: apiFailures.length === 0 ? 'API smoke 통과' : 'login HTML 또는 테이블 없음 응답이 나는 API 수정',
    }),
    check({
      tenant_id: tenantId,
      check_key: 'external_spend_guard',
      status: input.externalApiWrites === 0 ? 'pass' : 'blocked',
      severity: input.externalApiWrites === 0 ? 'info' : 'critical',
      evidence: { external_api_write_count: input.externalApiWrites },
      next_action: input.externalApiWrites === 0 ? '승인 전 live spend 0원 유지' : 'external_api_write=true job을 즉시 감사하고 중지',
    }),
    check({
      tenant_id: tenantId,
      check_key: 'full_auto_disabled',
      status: input.fullAutoEnabled === 0 ? 'pass' : 'blocked',
      severity: input.fullAutoEnabled === 0 ? 'info' : 'critical',
      evidence: { full_auto_enabled_workspaces: input.fullAutoEnabled },
      next_action: input.fullAutoEnabled === 0 ? '기본 승인형 자동화 유지' : '별도 운영 승인 전 full_auto를 비활성화',
    }),
    check({
      tenant_id: tenantId,
      check_key: 'workspace_ready',
      status: (input.counts.tenant_ad_workspaces || 0) > 0 ? 'pass' : 'warn',
      severity: (input.counts.tenant_ad_workspaces || 0) > 0 ? 'low' : 'medium',
      evidence: { workspaces: input.counts.tenant_ad_workspaces || 0 },
      next_action: (input.counts.tenant_ad_workspaces || 0) > 0 ? 'tenant별 예산/권한 사용 가능' : 'tenant workspace를 생성해 SaaS 예산/승인자/리스크 정책을 고정',
    }),
    check({
      tenant_id: tenantId,
      check_key: 'execution_queue_ready',
      status: (input.counts.ad_os_platform_jobs || 0) + (input.counts.ad_os_conversion_upload_jobs || 0) > 0 ? 'pass' : 'warn',
      severity: 'low',
      evidence: {
        platform_jobs: input.counts.ad_os_platform_jobs || 0,
        conversion_upload_jobs: input.counts.ad_os_conversion_upload_jobs || 0,
      },
      next_action: '상품 1개로 platform job, conversion upload job, portfolio plan 생성 후 dry-run executor 검증',
    }),
  ];
}

export function decidePlatformJobExecution(
  job: PlatformExecutionJob,
  options: { mode?: PlatformExecutionMode; runId?: string | null; now?: string } = {},
): PlatformExecutionDecision {
  const mode = options.mode || 'dry_run';
  const now = options.now || nowIso();
  const requestPayload = job.request_payload || {};
  const activeMutation = ['activate_keyword', 'pause_keyword', 'update_bid'].includes(job.job_type);
  const dryRun = mode !== 'active_allowed';
  const baseAttempt: ExecutionAttemptRow = {
    tenant_id: job.tenant_id ?? null,
    platform: job.platform,
    job_id: job.id,
    run_id: options.runId ?? null,
    attempt_type: 'platform_job',
    status: 'blocked',
    dry_run: true,
    external_api_write: false,
    request_payload: requestPayload,
    response_payload: {},
    blocked_reason: null,
    retryable: false,
    started_at: now,
    finished_at: now,
  };

  const block = (reason: string, retryable = false): PlatformExecutionDecision => ({
    attempt: { ...baseAttempt, status: 'blocked', blocked_reason: reason, retryable, response_payload: { blocked_reason: reason } },
    jobPatch: {
      status: 'blocked',
      guardrail_status: 'blocked',
      blocked_reason: reason,
      response_payload: { blocked_reason: reason, external_api_write: false },
      finished_at: now,
      external_api_write: false,
    },
  });

  if (!['approved', 'running'].includes(job.status)) return block(`job_status_${job.status}`);
  if (job.external_api_write) return block('unexpected_external_api_write_flag');
  if (job.platform === 'google' && activeMutation) return block('google_live_publish_disabled');
  if (job.platform === 'meta' && !['upload_conversion', 'sync_asset', 'dry_run'].includes(job.job_type)) return block('meta_campaign_publish_disabled');
  if (activeMutation && Number(job.automation_level || 0) < 3) return block('limited_autopilot_required');
  if (activeMutation && mode !== 'active_allowed') return block('active_mutation_requires_explicit_limited_autopilot');
  if (job.platform === 'kakao') return block('kakao_adapter_not_ready', true);

  const responsePayload = {
    executor: 'ad_os_v61_v75_guarded_runtime',
    mode,
    dry_run: dryRun,
    external_api_write: false,
    platform: job.platform,
    job_type: job.job_type,
    note: dryRun ? 'staging verification only; no live spend' : 'active writes are still disabled in this adapter',
  };

  return {
    attempt: {
      ...baseAttempt,
      status: 'succeeded',
      dry_run: true,
      external_api_write: false,
      response_payload: responsePayload,
    },
    jobPatch: {
      status: 'succeeded',
      guardrail_status: 'passed',
      blocked_reason: null,
      response_payload: responsePayload,
      started_at: now,
      finished_at: now,
      external_api_write: false,
    },
  };
}

export function decideConversionUploadExecution(
  job: ConversionUploadRuntimeJob,
  options: { runId?: string | null; now?: Date } = {},
): ConversionExecutionDecision {
  const now = options.now || new Date();
  const nowText = now.toISOString();
  const ageDays = daysOld(job.event_time, now);
  const staleStatus = ageDays > 90 ? 'expired' : ageDays > 30 ? 'stale' : 'fresh';
  const dedupeStatus = job.dedupe_status || 'unique';
  const baseAttempt: ExecutionAttemptRow = {
    tenant_id: job.tenant_id ?? null,
    platform: job.platform,
    conversion_upload_job_id: job.id,
    run_id: options.runId ?? null,
    attempt_type: 'conversion_upload',
    status: 'blocked',
    dry_run: true,
    external_api_write: false,
    request_payload: job.upload_payload || {},
    response_payload: {},
    blocked_reason: null,
    retryable: false,
    started_at: nowText,
    finished_at: nowText,
  };

  const block = (reason: string, retryable = false): ConversionExecutionDecision => ({
    attempt: { ...baseAttempt, status: 'blocked', blocked_reason: reason, retryable, response_payload: { blocked_reason: reason } },
    jobPatch: {
      status: 'blocked',
      blocked_reason: reason,
      response_payload: { blocked_reason: reason, external_api_write: false },
      freshness_status: staleStatus,
      dedupe_status: dedupeStatus,
      retry_count: Number(job.retry_count || 0) + (retryable ? 1 : 0),
      next_retry_at: retryable ? new Date(now.getTime() + 3_600_000).toISOString() : null,
    },
  });

  if (!['planned', 'approved', 'running'].includes(job.status)) return block(`upload_job_status_${job.status}`);
  if (job.blocked_reason) return block(job.blocked_reason);
  if (job.consent_status !== 'granted') return block('consent_not_granted');
  if (Number(job.signal_quality_score || 0) < 60) return block('signal_quality_below_threshold');
  if (staleStatus !== 'fresh') return block(`event_${staleStatus}`);
  if (dedupeStatus !== 'unique') return block(`dedupe_${dedupeStatus}`);

  const externalUploadId = `dryrun:${job.platform}:${job.id}`;
  const responsePayload = {
    executor: 'ad_os_v61_v75_conversion_runtime',
    external_upload_id: externalUploadId,
    dry_run: true,
    external_api_write: false,
    platform: job.platform,
  };

  return {
    attempt: {
      ...baseAttempt,
      status: 'succeeded',
      response_payload: responsePayload,
    },
    jobPatch: {
      status: 'uploaded',
      blocked_reason: null,
      response_payload: responsePayload,
      external_upload_id: externalUploadId,
      uploaded_at: nowText,
      freshness_status: 'fresh',
      dedupe_status: 'unique',
      next_retry_at: null,
    },
  };
}

export function buildExperimentTemplates(tenantId: string | null = null): ExperimentTemplateRow[] {
  const base = {
    tenant_id: tenantId,
    primary_metric: 'margin_roas' as const,
    status: 'active' as const,
  };
  return [
    {
      ...base,
      template_key: 'global_holdout_margin_roas',
      experiment_type: 'holdout',
      minimum_clicks: 300,
      minimum_conversions: 8,
      minimum_days: 14,
      confidence_threshold: 0.85,
      automation_level_required: 3,
      config: { budget_reallocation_allowed: false, purpose: 'incrementality guard before full auto' },
    },
    {
      ...base,
      template_key: 'date_split_deadline_risk',
      experiment_type: 'date_split',
      minimum_clicks: 160,
      minimum_conversions: 5,
      minimum_days: 10,
      confidence_threshold: 0.8,
      automation_level_required: 2,
      config: { split: 'weekday_vs_weekend', auto_winner: false },
    },
    {
      ...base,
      template_key: 'landing_ab_cta_repair',
      experiment_type: 'landing_ab',
      minimum_clicks: 120,
      minimum_conversions: 4,
      minimum_days: 7,
      confidence_threshold: 0.8,
      automation_level_required: 2,
      config: { variants: ['current', 'cta_repair'], primary_guardrail: 'bounce_rate' },
    },
    {
      ...base,
      template_key: 'creative_ab_fatigue_refresh',
      experiment_type: 'creative_ab',
      minimum_clicks: 100,
      minimum_conversions: 3,
      minimum_days: 7,
      confidence_threshold: 0.78,
      automation_level_required: 2,
      config: { variants: ['incumbent', 'fresh_angle'], auto_winner: false },
    },
    {
      ...base,
      template_key: 'match_type_ab_longtail',
      experiment_type: 'match_type_ab',
      minimum_clicks: 180,
      minimum_conversions: 5,
      minimum_days: 10,
      confidence_threshold: 0.82,
      automation_level_required: 3,
      config: { match_types: ['exact', 'phrase'], negative_keyword_required: true },
    },
  ];
}

export function buildTenantAuditExport(input: {
  workspace: TenantWorkspaceForExport;
  metrics: JsonRecord;
  periodStart: string;
  periodEnd: string;
}): TenantAuditExportRow {
  const workspace = input.workspace;
  const externalWriteCount = Number(input.metrics.external_api_writes || 0);
  const fullAutoEnabled = Boolean(workspace.full_auto_enabled);
  const safetyStatus = externalWriteCount === 0 && !fullAutoEnabled ? 'ready' : 'draft';
  const exportPayload = {
    workspace: {
      id: workspace.id,
      name: workspace.workspace_name || 'Ad OS Workspace',
      tenant_id: workspace.tenant_id || null,
      automation_level: Number(workspace.automation_level || 2),
      require_human_approval: workspace.require_human_approval !== false,
      full_auto_enabled: fullAutoEnabled,
      risk_status: workspace.risk_status || 'normal',
      data_retention_days: Number(workspace.data_retention_days || 730),
      forbidden_keywords: workspace.forbidden_keywords || [],
    },
    budget_caps: {
      monthly_budget_cap_krw: Number(workspace.monthly_budget_cap_krw || 0),
      daily_budget_cap_krw: Number(workspace.daily_budget_cap_krw || 0),
      channel_budget_caps: workspace.channel_budget_caps || {},
      max_cpc_krw: Number(workspace.max_cpc_krw || 0),
      max_test_loss_krw: Number(workspace.max_test_loss_krw || 0),
    },
    safety: {
      external_api_writes: externalWriteCount,
      full_auto_enabled: fullAutoEnabled,
      approval_required: workspace.require_human_approval !== false,
      live_spend_guard: externalWriteCount === 0,
    },
    metrics: input.metrics,
  };

  return {
    tenant_id: workspace.tenant_id || null,
    workspace_id: workspace.id,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    status: safetyStatus,
    export_payload: exportPayload,
    report_payload: {
      title: `${workspace.workspace_name || 'Ad OS'} monthly audit`,
      summary: safetyStatus === 'ready'
        ? '승인형 자동화, live spend 0원, full auto off 기준을 만족합니다.'
        : '외부 write 또는 full auto 설정을 운영 승인 전에 재점검해야 합니다.',
      next_actions: [
        '권한 없음/캠페인 없음 채널 상태를 해결',
        '전환 clean signal 업로드 후보를 검증',
        'portfolio plan 승인 큐에서 pause/scale/landing repair를 검토',
      ],
    },
  };
}
