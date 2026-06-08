import { describe, expect, it } from 'vitest';
import {
  buildAdOsCredentialReadiness,
  summarizeAdOsCredentialReadiness,
} from './ad-os-credential-readiness';

describe('ad-os credential readiness', () => {
  it('summarizes missing credentials without exposing secret values', () => {
    const readiness = buildAdOsCredentialReadiness({
      hasSecret: (key) => key === 'NAVER_ADS_API_KEY',
    });
    const naver = readiness.find((item) => item.platform === 'naver');
    const google = readiness.find((item) => item.platform === 'google');

    expect(naver).toMatchObject({
      status: 'partial',
      required_ready: 1,
      missing_required: ['NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID'],
    });
    expect(google?.status).toBe('missing');
    expect(JSON.stringify(readiness)).not.toContain('secret-value');
  });

  it('marks live-write safety false when a live flag is enabled', () => {
    const readiness = buildAdOsCredentialReadiness({
      hasSecret: () => true,
      getFlag: (key) => (key === 'AD_OS_NAVER_LIMITED_WRITE_ENABLED' ? 'true' : null),
    });
    const summary = summarizeAdOsCredentialReadiness(readiness);

    expect(readiness.find((item) => item.platform === 'naver')?.live_write_safe).toBe(false);
    expect(summary.live_write_safe).toBe(false);
    expect(summary.live_flags_enabled).toEqual(['AD_OS_NAVER_LIMITED_WRITE_ENABLED']);
  });

  it('marks platforms ready when all required secrets exist and live flags are off', () => {
    const readiness = buildAdOsCredentialReadiness({
      hasSecret: () => true,
      getFlag: () => 'false',
    });
    const summary = summarizeAdOsCredentialReadiness(readiness);

    expect(summary).toMatchObject({ platforms: 3, ready: 3, partial: 0, missing: 0, live_write_safe: true });
  });
});
