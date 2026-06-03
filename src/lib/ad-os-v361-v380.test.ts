import { describe, expect, it } from 'vitest';
import { buildAdOsCompletionAuditSummary } from './ad-os-v361-v380';

describe('buildAdOsCompletionAuditSummary', () => {
  it('passes when every platform-grade safety and operating signal is present', () => {
    const summary = buildAdOsCompletionAuditSummary({
      platformJobQueue: { total: 3, blocked: 0, approved_or_running: 1, external_api_write_count: 0 },
      runtimeExecution: { total: 2, blocked: 0, external_api_write_count: 0 },
      channelAdapters: { snapshots: 3, paused_write_ready: 1, draft_ready: 1, executable: 1, blocked: 0, external_api_write_count: 0 },
      writePackets: { total: 2, blocked: 0, external_api_write_count: 0 },
      executionGates: { total: 2, blocked: 0, external_api_write_count: 0 },
      rollbackDrills: { total: 1, blocked: 0, external_api_write_count: 0 },
      limitedWritePilot: { total: 1, blocked: 0, external_api_write_count: 0 },
      conversionDataQuality: { status: 'healthy', uploadable_conversions: 8, blocked_conversions: 0, attribution_coverage: 0.9 },
      learningLoop: { status: { attribution_ready: true, margin_learning_ready: true } },
      tenantPolicy: {
        configured: true,
        full_auto_enabled: false,
        monthly_budget_cap_krw: 1_000_000,
        daily_budget_cap_krw: 100_000,
        max_cpc_krw: 500,
        max_test_loss_krw: 50_000,
        require_human_approval: true,
      },
      tenantGuardrails: [{ status: 'pass' }],
      tenantAdReadiness: [{ status: 'pass' }],
      incidentResponse: { critical: 0, high: 0, open: 0, kill_switch_recommended: false },
      agencyReporting: {
        status: 'ready',
        readiness_score: 100,
        active_billing_profiles: 1,
        ready_or_draft_reports: 1,
        ready_audit_exports: 1,
        full_auto_enabled: 0,
      },
      experimentStandards: { templates: 4, active: 1, types: 4 },
      runtimeReadiness: { checks: 5, blocked_or_failed: 0, critical: 0 },
      creativeFactory: { variants: 10, duplicate_content_risks: 0 },
    });

    expect(summary.status).toBe('ready');
    expect(summary.failed).toBe(0);
    expect(summary.warnings).toBe(0);
    expect(summary.readiness_score).toBe(100);
  });

  it('blocks completion when external writes or full auto are detected', () => {
    const summary = buildAdOsCompletionAuditSummary({
      platformJobQueue: { total: 1, blocked: 0, external_api_write_count: 1 },
      runtimeExecution: { blocked: 0, external_api_write_count: 0 },
      tenantPolicy: {
        configured: true,
        full_auto_enabled: true,
        monthly_budget_cap_krw: 1_000_000,
        daily_budget_cap_krw: 100_000,
        max_cpc_krw: 500,
        max_test_loss_krw: 50_000,
        require_human_approval: true,
      },
      incidentResponse: { critical: 1, high: 0, open: 1, kill_switch_recommended: true },
      agencyReporting: { status: 'blocked', readiness_score: 40, full_auto_enabled: 1 },
      conversionDataQuality: { uploadable_conversions: 0, blocked_conversions: 2 },
    });

    expect(summary.status).toBe('blocked');
    expect(summary.failed).toBeGreaterThanOrEqual(4);
    expect(summary.requirements.find((row) => row.id === 'external_write_zero')?.status).toBe('fail');
    expect(summary.requirements.find((row) => row.id === 'full_auto_default_off')?.status).toBe('fail');
  });

  it('keeps the goal open with warnings when data evidence is not yet collected', () => {
    const summary = buildAdOsCompletionAuditSummary({
      platformJobQueue: { total: 0, blocked: 0, external_api_write_count: 0 },
      runtimeExecution: { blocked: 0, external_api_write_count: 0 },
      channelAdapters: { snapshots: 0, blocked: 0, external_api_write_count: 0 },
      conversionDataQuality: { status: 'unknown', uploadable_conversions: 0, blocked_conversions: 0 },
      learningLoop: { status: { attribution_ready: false, margin_learning_ready: false } },
      tenantPolicy: {
        configured: true,
        full_auto_enabled: false,
        monthly_budget_cap_krw: 1_000_000,
        daily_budget_cap_krw: 100_000,
        max_cpc_krw: 500,
        max_test_loss_krw: 50_000,
        require_human_approval: true,
      },
      incidentResponse: { critical: 0, high: 0, open: 0, kill_switch_recommended: false },
      agencyReporting: { status: 'needs_attention', readiness_score: 70, full_auto_enabled: 0 },
    });

    expect(summary.status).toBe('needs_attention');
    expect(summary.failed).toBe(0);
    expect(summary.warnings).toBeGreaterThan(0);
    expect(summary.requirements.find((row) => row.id === 'learning_loop_margin_fact')?.status).toBe('warn');
  });
});
