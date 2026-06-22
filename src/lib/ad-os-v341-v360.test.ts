import { describe, expect, it } from 'vitest';
import { buildAgencyReportingSummary } from './ad-os-v341-v360';

describe('ad-os-v341-v360 agency reporting summary', () => {
  it('marks the reporting package ready when workspace, billing, report, audit export, and incidents are clean', () => {
    const summary = buildAgencyReportingSummary({
      tenantWorkspaces: [{ tenant_id: 'tenant-a', workspace_name: 'Tenant A', automation_level: 3, full_auto_enabled: false }],
      tenantBillingProfiles: [{ tenant_id: 'tenant-a', invoice_status: 'active', billing_plan: 'agency' }],
      tenantReports: [{ tenant_id: 'tenant-a', report_type: 'monthly', status: 'draft', period_start: '2026-06-01', period_end: '2026-06-30' }],
      tenantAuditExports: [{ tenant_id: 'tenant-a', status: 'ready', period_start: '2026-06-01', period_end: '2026-06-30' }],
      incidentResponse: { critical: 0, high: 0, open: 0, kill_switch_recommended: false },
    });

    expect(summary).toMatchObject({
      status: 'ready',
      readiness_score: 100,
      billable_tenants: 1,
      ready_or_draft_reports: 1,
      ready_audit_exports: 1,
      missing: [],
    });
  });

  it('shows specific missing pieces before SaaS report delivery', () => {
    const summary = buildAgencyReportingSummary({
      tenantWorkspaces: [{ tenant_id: 'tenant-a', automation_level: 3 }],
      tenantBillingProfiles: [],
      tenantReports: [],
      tenantAuditExports: [],
      incidentResponse: { critical: 0, high: 0, open: 0 },
    });

    expect(summary.status).toBe('needs_attention');
    expect(summary.readiness_score).toBeLessThan(70);
    expect(summary.missing).toEqual(expect.arrayContaining([
      'active_billing_profile',
      'monthly_report_draft',
      'audit_export_ready',
    ]));
    expect(summary.next_action).toContain('과금 프로필');
  });

  it('blocks reporting when full auto or critical incidents are present', () => {
    const summary = buildAgencyReportingSummary({
      tenantWorkspaces: [{ tenant_id: 'tenant-a', automation_level: 5, full_auto_enabled: true }],
      tenantBillingProfiles: [{ tenant_id: 'tenant-a', invoice_status: 'active' }],
      tenantReports: [{ tenant_id: 'tenant-a', report_type: 'monthly', status: 'draft' }],
      tenantAuditExports: [{ tenant_id: 'tenant-a', status: 'ready' }],
      incidentResponse: { critical: 1, high: 1, open: 2, kill_switch_recommended: true },
    });

    expect(summary.status).toBe('blocked');
    expect(summary.full_auto_enabled).toBe(1);
    expect(summary.open_incidents).toBe(2);
    expect(summary.missing).toEqual(expect.arrayContaining([
      'full_auto_policy_review',
      'critical_incident_clearance',
      'high_incident_review',
    ]));
  });
});
