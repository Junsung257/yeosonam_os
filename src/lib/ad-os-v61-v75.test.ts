import { describe, expect, it } from 'vitest';
import {
  buildExperimentTemplates,
  buildRuntimeReadinessChecks,
  buildTenantAuditExport,
  decideConversionUploadExecution,
  decidePlatformJobExecution,
} from './ad-os-v61-v75';

describe('ad-os-v61-v75 runtime readiness', () => {
  it('flags missing runtime tables and keeps full auto as a blocker', () => {
    const checks = buildRuntimeReadinessChecks({
      tables: {
        ad_os_platform_jobs: true,
        ad_os_conversion_upload_jobs: true,
      },
      apiJson: { summary: true, data_quality: false },
      counts: { tenant_ad_workspaces: 0, ad_os_platform_jobs: 0, ad_os_conversion_upload_jobs: 0 },
      fullAutoEnabled: 1,
      externalApiWrites: 0,
    });

    expect(checks.find((check) => check.check_key === 'migration_tables')).toMatchObject({ status: 'blocked' });
    expect(checks.find((check) => check.check_key === 'full_auto_disabled')).toMatchObject({ status: 'blocked' });
    expect(checks.find((check) => check.check_key === 'admin_api_json')).toMatchObject({ status: 'fail' });
  });
});

describe('ad-os-v61-v75 platform executor', () => {
  it('succeeds dry-run for paused keyword creation without external write', () => {
    const decision = decidePlatformJobExecution({
      id: 'job-1',
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'approved',
      automation_level: 2,
      request_payload: { keyword: '부산 부모님 다낭 패키지' },
    });

    expect(decision.attempt).toMatchObject({ status: 'succeeded', dry_run: true, external_api_write: false });
    expect(decision.jobPatch).toMatchObject({ status: 'succeeded', external_api_write: false });
  });

  it('blocks keyword activation unless limited autopilot is explicitly allowed', () => {
    const decision = decidePlatformJobExecution({
      id: 'job-2',
      platform: 'naver',
      job_type: 'activate_keyword',
      status: 'approved',
      automation_level: 3,
      request_payload: { keyword: '다낭 마감임박' },
    }, { mode: 'paused_only' });

    expect(decision.attempt.status).toBe('blocked');
    expect(decision.attempt.blocked_reason).toBe('active_mutation_requires_explicit_limited_autopilot');
    expect(decision.attempt.external_api_write).toBe(false);
  });

  it('keeps Google live publish disabled', () => {
    const decision = decidePlatformJobExecution({
      id: 'job-3',
      platform: 'google',
      job_type: 'update_bid',
      status: 'approved',
      automation_level: 4,
    }, { mode: 'active_allowed' });

    expect(decision.jobPatch).toMatchObject({ status: 'blocked', blocked_reason: 'google_live_publish_disabled' });
  });
});

describe('ad-os-v61-v75 conversion upload executor', () => {
  it('validates clean conversion candidates without marking them uploaded', () => {
    const decision = decideConversionUploadExecution({
      id: 'upload-1',
      platform: 'google',
      status: 'planned',
      event_name: 'Purchase',
      event_time: '2026-06-01T00:00:00.000Z',
      consent_status: 'granted',
      signal_quality_score: 82,
      dedupe_status: 'unique',
      upload_payload: { gclid: 'gclid-1' },
    }, { now: new Date('2026-06-02T00:00:00.000Z') });

    expect(decision.attempt).toMatchObject({ status: 'succeeded', external_api_write: false });
    expect(decision.jobPatch.status).toBe('approved');
    expect(decision.jobPatch.external_upload_id).toBeNull();
    expect(decision.jobPatch.uploaded_at).toBeNull();
    expect(decision.jobPatch.response_payload).toMatchObject({
      dry_run: true,
      external_api_write: false,
      dry_run_verification_id: 'dryrun:google:upload-1',
    });
  });

  it('blocks low-quality, stale, duplicate, or non-consented signals', () => {
    const lowQuality = decideConversionUploadExecution({
      id: 'upload-2',
      platform: 'meta',
      status: 'planned',
      event_time: '2026-06-01T00:00:00.000Z',
      consent_status: 'granted',
      signal_quality_score: 30,
    }, { now: new Date('2026-06-02T00:00:00.000Z') });
    const stale = decideConversionUploadExecution({
      id: 'upload-3',
      platform: 'google',
      status: 'planned',
      event_time: '2026-01-01T00:00:00.000Z',
      consent_status: 'granted',
      signal_quality_score: 90,
    }, { now: new Date('2026-06-02T00:00:00.000Z') });
    const duplicate = decideConversionUploadExecution({
      id: 'upload-4',
      platform: 'meta',
      status: 'planned',
      event_time: '2026-06-01T00:00:00.000Z',
      consent_status: 'granted',
      signal_quality_score: 90,
      dedupe_status: 'collision',
    }, { now: new Date('2026-06-02T00:00:00.000Z') });

    expect(lowQuality.jobPatch.blocked_reason).toBe('signal_quality_below_threshold');
    expect(stale.jobPatch.blocked_reason).toBe('event_expired');
    expect(duplicate.jobPatch.blocked_reason).toBe('dedupe_collision');
  });
});

describe('ad-os-v61-v75 experiments and SaaS export', () => {
  it('standardizes five experiment templates with sample thresholds', () => {
    const templates = buildExperimentTemplates();

    expect(templates.map((template) => template.experiment_type)).toEqual(
      expect.arrayContaining(['holdout', 'date_split', 'landing_ab', 'creative_ab', 'match_type_ab']),
    );
    expect(templates.every((template) => template.minimum_clicks > 0 && template.minimum_days >= 7)).toBe(true);
  });

  it('builds a tenant audit export with full-auto and live-write safety checks', () => {
    const row = buildTenantAuditExport({
      workspace: {
        id: 'workspace-1',
        workspace_name: 'Demo Tenant',
        monthly_budget_cap_krw: 100000,
        daily_budget_cap_krw: 10000,
        max_cpc_krw: 500,
        automation_level: 3,
        require_human_approval: true,
        full_auto_enabled: false,
      },
      metrics: { external_api_writes: 0, platform_jobs: 2 },
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    });

    expect(row.status).toBe('ready');
    expect(row.export_payload).toMatchObject({
      safety: { external_api_writes: 0, full_auto_enabled: false, live_spend_guard: true },
    });
  });
});
