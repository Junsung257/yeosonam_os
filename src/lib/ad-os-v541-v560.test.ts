import { describe, expect, it } from 'vitest';
import { buildAdOsStagingSmokeSummary } from './ad-os-v541-v560';

describe('ad-os-v541-v560 staging smoke summary', () => {
  it('summarizes the Danang end-to-end smoke fixture as a passing read-only gate', () => {
    const summary = buildAdOsStagingSmokeSummary();

    expect(summary.status).toBe('pass');
    expect(summary.failed_assertions).toBe(0);
    expect(summary.passed_assertions).toBe(Object.keys(summary.assertions).length);
    expect(Object.values(summary.assertions).every(Boolean)).toBe(true);
    expect(summary.next_action).toContain('Staging smoke passes');
  });

  it('keeps staging smoke evidence isolated from live writes and database mutations', () => {
    const summary = buildAdOsStagingSmokeSummary();

    expect(summary.safety).toEqual({
      read_only: true,
      external_api_write: false,
      database_mutation: false,
      fixture_only: true,
    });
    expect(summary.evidence).toMatchObject({
      package_id: 'fixture-danang-airbusan-parent',
      tenant_id: 'tenant-smoke',
      destination: 'Danang',
      platform_job_status: 'approved',
      platform_job_type: 'create_paused_keyword',
      conversion_upload_status: 'planned',
      conversion_platform: 'google',
      external_api_write_zero: true,
    });
  });

  it('includes enough counts to prove the product, creative, platform, conversion, and learning chain', () => {
    const summary = buildAdOsStagingSmokeSummary();

    expect(summary.counts.scenarios).toBeGreaterThan(0);
    expect(summary.counts.keywords).toBeGreaterThan(10);
    expect(summary.counts.intent_signals).toBeGreaterThan(0);
    expect(summary.counts.creative_variants).toBeGreaterThan(0);
    expect(summary.counts.platform_jobs).toBe(1);
    expect(summary.counts.conversion_upload_jobs).toBe(1);
    expect(summary.counts.portfolio_plans).toBeGreaterThan(0);
  });
});
