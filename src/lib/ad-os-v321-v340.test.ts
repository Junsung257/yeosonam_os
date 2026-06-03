import { describe, expect, it } from 'vitest';
import { buildAdOsIncidentSummary } from './ad-os-v321-v340';

describe('ad-os-v321-v340 incident response', () => {
  it('raises critical incidents for live writes and full auto workspaces', () => {
    const summary = buildAdOsIncidentSummary({
      platformJobs: [{ id: 'job-1', platform: 'naver', status: 'succeeded', external_api_write: true }],
      executionAttempts: [{ id: 'attempt-1', platform: 'naver', status: 'succeeded', attempt_type: 'platform_job', external_api_write: true }],
      tenantWorkspaces: [{ id: 'ws-1', full_auto_enabled: true, automation_level: 5, monthly_budget_cap_krw: 100000, daily_budget_cap_krw: 10000 }],
    });

    expect(summary.critical).toBe(2);
    expect(summary.kill_switch_recommended).toBe(true);
    expect(summary.alerts.map((alert) => alert.id)).toEqual(expect.arrayContaining([
      'external_api_write_detected',
      'full_auto_enabled',
    ]));
  });

  it('summarizes conversion quality and executor blockers without recommending kill switch', () => {
    const summary = buildAdOsIncidentSummary({
      conversionUploadJobs: [
        { id: 'conv-1', platform: 'google', status: 'blocked', blocked_reason: 'consent_denied', signal_quality_score: 80 },
        { id: 'conv-2', platform: 'meta', status: 'blocked', blocked_reason: 'dedupe_duplicate', signal_quality_score: 90 },
      ],
      dataQualitySnapshots: [{ status: 'blocked', blocked_upload_events: 2, duplicate_dedupe_keys: 1 }],
      executionAttempts: [{ id: 'attempt-2', status: 'blocked', attempt_type: 'conversion_upload', blocked_reason: 'signal_quality_below_threshold', retryable: true }],
      platformJobs: [{ id: 'job-2', status: 'blocked', guardrail_status: 'blocked', blocked_reason: 'budget_guard_not_ready' }],
    });

    expect(summary.critical).toBe(0);
    expect(summary.high).toBeGreaterThanOrEqual(2);
    expect(summary.kill_switch_recommended).toBe(false);
    expect(summary.alerts[0].severity).toBe('high');
    expect(summary.alerts.map((alert) => alert.id)).toEqual(expect.arrayContaining([
      'conversion_upload_blocked',
      'data_quality_blocked',
      'executor_failed_or_blocked',
      'platform_jobs_blocked',
    ]));
  });

  it('keeps a clean system in watch mode with no alerts', () => {
    const summary = buildAdOsIncidentSummary({
      platformJobs: [{ id: 'job-ok', status: 'approved', external_api_write: false }],
      conversionUploadJobs: [{ id: 'conv-ok', status: 'planned', blocked_reason: null }],
      tenantWorkspaces: [{ id: 'ws-ok', full_auto_enabled: false, automation_level: 3, monthly_budget_cap_krw: 100000, daily_budget_cap_krw: 10000 }],
    });

    expect(summary.total).toBe(0);
    expect(summary.kill_switch_recommended).toBe(false);
    expect(summary.top_next_action).toContain('No incidents detected');
  });
});
