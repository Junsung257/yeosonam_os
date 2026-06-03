export type AdOsIncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AdOsIncidentStatus = 'open' | 'watch';

export type AdOsIncidentAlert = {
  id: string;
  severity: AdOsIncidentSeverity;
  status: AdOsIncidentStatus;
  category:
    | 'external_spend'
    | 'automation_policy'
    | 'conversion_quality'
    | 'executor_failure'
    | 'runtime_readiness';
  title: string;
  reason: string;
  next_action: string;
  evidence: Record<string, unknown>;
};

export type AdOsIncidentSummary = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  open: number;
  watch: number;
  kill_switch_recommended: boolean;
  top_next_action: string;
  alerts: AdOsIncidentAlert[];
};

type PlatformJobSignal = {
  id?: string | null;
  platform?: string | null;
  status?: string | null;
  job_type?: string | null;
  external_api_write?: boolean | null;
  blocked_reason?: string | null;
  guardrail_status?: string | null;
};

type ConversionUploadSignal = {
  id?: string | null;
  platform?: string | null;
  status?: string | null;
  event_name?: string | null;
  blocked_reason?: string | null;
  signal_quality_score?: number | null;
  response_payload?: unknown;
};

type DataQualitySignal = {
  status?: string | null;
  blocked_upload_events?: number | null;
  duplicate_dedupe_keys?: number | null;
  attribution_coverage_pct?: number | null;
};

type ExecutionAttemptSignal = {
  id?: string | null;
  platform?: string | null;
  attempt_type?: string | null;
  status?: string | null;
  external_api_write?: boolean | null;
  blocked_reason?: string | null;
  retryable?: boolean | null;
};

type TenantWorkspaceSignal = {
  id?: string | null;
  tenant_id?: string | null;
  full_auto_enabled?: boolean | null;
  automation_level?: number | null;
  risk_status?: string | null;
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
};

function severityRank(severity: AdOsIncidentSeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity];
}

function boolFromPayload(row: ConversionUploadSignal, key: string): boolean {
  const payload = row.response_payload;
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as Record<string, unknown>)[key] === true);
}

function alert(input: Omit<AdOsIncidentAlert, 'status'> & { status?: AdOsIncidentStatus }): AdOsIncidentAlert {
  return {
    status: input.severity === 'critical' || input.severity === 'high' ? 'open' : 'watch',
    ...input,
  };
}

export function buildAdOsIncidentSummary(input: {
  platformJobs?: PlatformJobSignal[];
  conversionUploadJobs?: ConversionUploadSignal[];
  dataQualitySnapshots?: DataQualitySignal[];
  executionAttempts?: ExecutionAttemptSignal[];
  tenantWorkspaces?: TenantWorkspaceSignal[];
}): AdOsIncidentSummary {
  const alerts: AdOsIncidentAlert[] = [];
  const platformJobs = input.platformJobs || [];
  const conversionUploadJobs = input.conversionUploadJobs || [];
  const dataQualitySnapshots = input.dataQualitySnapshots || [];
  const executionAttempts = input.executionAttempts || [];
  const tenantWorkspaces = input.tenantWorkspaces || [];

  const liveWriteJobs = platformJobs.filter((row) => row.external_api_write);
  const liveWriteAttempts = executionAttempts.filter((row) => row.external_api_write);
  const liveWriteConversions = conversionUploadJobs.filter((row) => boolFromPayload(row, 'external_api_write'));
  const liveWriteCount = liveWriteJobs.length + liveWriteAttempts.length + liveWriteConversions.length;
  if (liveWriteCount > 0) {
    alerts.push(alert({
      id: 'external_api_write_detected',
      severity: 'critical',
      category: 'external_spend',
      title: 'External write detected',
      reason: 'At least one Ad OS job or executor attempt is marked as an external API write.',
      next_action: 'Run tenant/channel kill switch review, confirm external ids, and reconcile spend before approving more jobs.',
      evidence: {
        platform_jobs: liveWriteJobs.length,
        execution_attempts: liveWriteAttempts.length,
        conversion_uploads: liveWriteConversions.length,
      },
    }));
  }

  const fullAutoWorkspaces = tenantWorkspaces.filter((row) => row.full_auto_enabled || Number(row.automation_level || 0) >= 5);
  if (fullAutoWorkspaces.length > 0) {
    alerts.push(alert({
      id: 'full_auto_enabled',
      severity: 'critical',
      category: 'automation_policy',
      title: 'Full auto workspace enabled',
      reason: 'Full automation should remain off until a separate operations approval and sufficient performance evidence exist.',
      next_action: 'Disable full_auto_enabled or downgrade automation level until the tenant has an approved full-auto policy.',
      evidence: { workspaces: fullAutoWorkspaces.length },
    }));
  }

  const missingBudgetWorkspaces = tenantWorkspaces.filter((row) =>
    Number(row.automation_level || 0) >= 3 &&
    (Number(row.monthly_budget_cap_krw || 0) <= 0 || Number(row.daily_budget_cap_krw || 0) <= 0),
  );
  if (missingBudgetWorkspaces.length > 0) {
    alerts.push(alert({
      id: 'limited_auto_missing_budget_caps',
      severity: 'high',
      category: 'automation_policy',
      title: 'Limited autopilot missing budget caps',
      reason: 'A workspace allows limited automation but does not have both monthly and daily caps.',
      next_action: 'Set tenant monthly and daily budget caps before running executor actions.',
      evidence: { workspaces: missingBudgetWorkspaces.length },
    }));
  }

  const blockedConversions = conversionUploadJobs.filter((row) => row.status === 'blocked');
  if (blockedConversions.length > 0) {
    const reasons = blockedConversions.reduce<Record<string, number>>((acc, row) => {
      const reason = row.blocked_reason || 'unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    alerts.push(alert({
      id: 'conversion_upload_blocked',
      severity: 'high',
      category: 'conversion_quality',
      title: 'Conversion upload blocked',
      reason: 'Google/Meta conversion upload jobs are blocked by consent, identifiers, freshness, dedupe, or quality rules.',
      next_action: 'Fix the top blocked reason before using conversion uploads for optimization.',
      evidence: { blocked: blockedConversions.length, reasons },
    }));
  }

  const blockedDataQuality = dataQualitySnapshots.filter((row) =>
    row.status === 'blocked' ||
    Number(row.blocked_upload_events || 0) > 0 ||
    Number(row.duplicate_dedupe_keys || 0) > 0,
  );
  if (blockedDataQuality.length > 0) {
    alerts.push(alert({
      id: 'data_quality_blocked',
      severity: 'high',
      category: 'conversion_quality',
      title: 'Conversion data quality blocked',
      reason: 'Data quality snapshots show blocked uploads or duplicate dedupe keys.',
      next_action: 'Quarantine bad events and repair consent/dedupe mapping before learning or upload jobs.',
      evidence: {
        snapshots: blockedDataQuality.length,
        duplicate_dedupe_keys: blockedDataQuality.reduce((sum, row) => sum + Number(row.duplicate_dedupe_keys || 0), 0),
        blocked_upload_events: blockedDataQuality.reduce((sum, row) => sum + Number(row.blocked_upload_events || 0), 0),
      },
    }));
  }

  const failedAttempts = executionAttempts.filter((row) => ['failed', 'blocked'].includes(row.status || ''));
  if (failedAttempts.length > 0) {
    alerts.push(alert({
      id: 'executor_failed_or_blocked',
      severity: failedAttempts.some((row) => row.retryable === false) ? 'high' : 'medium',
      category: 'executor_failure',
      title: 'Executor failed or blocked',
      reason: 'One or more executor attempts failed or were blocked by runtime policy.',
      next_action: 'Review the failed queue, resolve blocker reasons, then rerun dry-run before any live gate.',
      evidence: {
        attempts: failedAttempts.length,
        reasons: failedAttempts.reduce<Record<string, number>>((acc, row) => {
          const reason = row.blocked_reason || 'unknown';
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        }, {}),
      },
    }));
  }

  const blockedPlatformJobs = platformJobs.filter((row) =>
    row.status === 'blocked' ||
    row.guardrail_status === 'blocked' ||
    Boolean(row.blocked_reason),
  );
  if (blockedPlatformJobs.length > 0) {
    alerts.push(alert({
      id: 'platform_jobs_blocked',
      severity: 'medium',
      category: 'runtime_readiness',
      title: 'Platform jobs blocked',
      reason: 'Approved execution cannot continue until platform job guardrail blockers are cleared.',
      next_action: 'Open failed queue and fix credentials, permission, campaign, budget, or approval blockers.',
      evidence: { jobs: blockedPlatformJobs.length },
    }));
  }

  const sorted = alerts.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const summary = {
    total: sorted.length,
    critical: sorted.filter((row) => row.severity === 'critical').length,
    high: sorted.filter((row) => row.severity === 'high').length,
    medium: sorted.filter((row) => row.severity === 'medium').length,
    low: sorted.filter((row) => row.severity === 'low').length,
    open: sorted.filter((row) => row.status === 'open').length,
    watch: sorted.filter((row) => row.status === 'watch').length,
    kill_switch_recommended: sorted.some((row) => row.severity === 'critical'),
    top_next_action: sorted[0]?.next_action || 'No incidents detected. Keep monitoring before enabling broader automation.',
    alerts: sorted.slice(0, 12),
  };

  return summary;
}
