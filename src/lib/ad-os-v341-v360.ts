type WorkspaceSignal = {
  tenant_id?: string | null;
  workspace_name?: string | null;
  audit_export_enabled?: boolean | null;
  full_auto_enabled?: boolean | null;
  automation_level?: number | null;
  risk_status?: string | null;
};

type BillingSignal = {
  tenant_id?: string | null;
  invoice_status?: string | null;
  billing_plan?: string | null;
  base_subscription_krw?: number | null;
  managed_spend_fee_pct?: number | null;
  performance_fee_pct?: number | null;
};

type TenantReportSignal = {
  tenant_id?: string | null;
  status?: string | null;
  report_type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

type AuditExportSignal = {
  tenant_id?: string | null;
  status?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

type IncidentSignal = {
  critical?: number | null;
  high?: number | null;
  open?: number | null;
  kill_switch_recommended?: boolean | null;
};

export type AgencyReportingStatus = 'ready' | 'needs_attention' | 'blocked';

export type AgencyReportingSummary = {
  status: AgencyReportingStatus;
  readiness_score: number;
  workspaces: number;
  billable_tenants: number;
  active_billing_profiles: number;
  monthly_reports: number;
  ready_or_draft_reports: number;
  audit_exports: number;
  ready_audit_exports: number;
  full_auto_enabled: number;
  open_incidents: number;
  missing: string[];
  next_action: string;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildAgencyReportingSummary(input: {
  tenantWorkspaces?: WorkspaceSignal[];
  tenantBillingProfiles?: BillingSignal[];
  tenantReports?: TenantReportSignal[];
  tenantAuditExports?: AuditExportSignal[];
  incidentResponse?: IncidentSignal | null;
}): AgencyReportingSummary {
  const workspaces = input.tenantWorkspaces || [];
  const billingProfiles = input.tenantBillingProfiles || [];
  const tenantReports = input.tenantReports || [];
  const auditExports = input.tenantAuditExports || [];
  const incident = input.incidentResponse || {};

  const activeBilling = billingProfiles.filter((row) => row.invoice_status === 'active');
  const billableTenants = new Set(activeBilling.map((row) => row.tenant_id || 'global')).size;
  const monthlyReports = tenantReports.filter((row) => row.report_type === 'monthly' || !row.report_type);
  const readyOrDraftReports = monthlyReports.filter((row) => ['ready', 'draft', 'sent'].includes(row.status || ''));
  const readyAuditExports = auditExports.filter((row) => row.status === 'ready');
  const fullAutoEnabled = workspaces.filter((row) => row.full_auto_enabled || Number(row.automation_level || 0) >= 5).length;
  const openIncidents = Number(incident.open || 0);

  const missing: string[] = [];
  if (workspaces.length === 0) missing.push('tenant_workspace');
  if (activeBilling.length === 0) missing.push('active_billing_profile');
  if (monthlyReports.length === 0) missing.push('monthly_report_draft');
  if (readyAuditExports.length === 0) missing.push('audit_export_ready');
  if (fullAutoEnabled > 0) missing.push('full_auto_policy_review');
  if (Number(incident.critical || 0) > 0 || incident.kill_switch_recommended) missing.push('critical_incident_clearance');
  if (Number(incident.high || 0) > 0) missing.push('high_incident_review');

  let score = 100;
  if (workspaces.length === 0) score -= 25;
  if (activeBilling.length === 0) score -= 20;
  if (monthlyReports.length === 0) score -= 15;
  if (readyAuditExports.length === 0) score -= 15;
  if (fullAutoEnabled > 0) score -= 20;
  score -= Math.min(30, Number(incident.critical || 0) * 15 + Number(incident.high || 0) * 8);

  const status: AgencyReportingStatus =
    Number(incident.critical || 0) > 0 || incident.kill_switch_recommended || fullAutoEnabled > 0
      ? 'blocked'
      : missing.length > 0
        ? 'needs_attention'
        : 'ready';

  const nextAction = missing.includes('critical_incident_clearance')
    ? '중요 사고를 해소하고 긴급 중지 점검을 실행한 뒤 광고주 보고서를 보내세요.'
    : missing.includes('full_auto_policy_review')
      ? '완전 자동 워크스페이스는 끄거나 별도 승인한 뒤 광고주 리포트를 묶으세요.'
      : missing.includes('active_billing_profile')
        ? '광고주 리포트 전에 과금 프로필을 생성하거나 활성화하세요.'
        : missing.includes('monthly_report_draft')
          ? '성과 근거에서 월간 광고주 리포트 초안을 생성하세요.'
          : missing.includes('audit_export_ready')
            ? '현재 보고 기간의 감사 파일을 준비하세요.'
            : '광고주 전달 전 운영자가 최종 검토하면 됩니다.';

  return {
    status,
    readiness_score: clampScore(score),
    workspaces: workspaces.length,
    billable_tenants: billableTenants,
    active_billing_profiles: activeBilling.length,
    monthly_reports: monthlyReports.length,
    ready_or_draft_reports: readyOrDraftReports.length,
    audit_exports: auditExports.length,
    ready_audit_exports: readyAuditExports.length,
    full_auto_enabled: fullAutoEnabled,
    open_incidents: openIncidents,
    missing,
    next_action: nextAction,
  };
}
