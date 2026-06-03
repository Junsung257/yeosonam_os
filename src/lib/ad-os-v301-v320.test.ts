import { describe, expect, it } from 'vitest';
import { buildDanangAdOsE2ESmoke } from './ad-os-v301-v320';

describe('ad-os-v301-v320 staging e2e smoke fixture', () => {
  it('proves one Danang package can move through candidate, queue, conversion, and learning without live spend', () => {
    const result = buildDanangAdOsE2ESmoke();

    expect(result.counts.scenarios).toBeGreaterThan(0);
    expect(result.counts.keywords).toBeGreaterThan(10);
    expect(result.counts.intent_signals).toBeGreaterThan(0);
    expect(result.counts.creative_variants).toBeGreaterThan(0);
    expect(result.counts.platform_jobs).toBe(1);
    expect(result.counts.conversion_upload_jobs).toBe(1);
    expect(result.counts.portfolio_plans).toBeGreaterThan(0);
    expect(Object.values(result.assertions)).toEqual(expect.arrayContaining([true]));
    expect(Object.values(result.assertions).every(Boolean)).toBe(true);
  });

  it('keeps executor and conversion jobs in safe approved/planned states', () => {
    const result = buildDanangAdOsE2ESmoke();

    expect(result.platformJob).toMatchObject({
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'approved',
      guardrail_status: 'passed',
      external_api_write: false,
    });
    expect(result.conversionUploadJob).toMatchObject({
      platform: 'google',
      status: 'planned',
      consent_status: 'granted',
      blocked_reason: null,
    });
    expect(result.conversionUploadJob.signal_quality_score).toBeGreaterThanOrEqual(60);
  });
});
