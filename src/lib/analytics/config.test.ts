import { afterEach, describe, expect, it } from 'vitest';
import {
  analyticsIdValidators,
  getPublicAnalyticsConfig,
  isProductionAnalyticsRuntime,
} from './config';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('analytics config', () => {
  it('validates public IDs without inventing values', () => {
    expect(analyticsIdValidators.gtm('GTM-ABC123')).toBe(true);
    expect(analyticsIdValidators.gtm('G-ABC123')).toBe(false);
    expect(analyticsIdValidators.ga4('G-ABC123')).toBe(true);
    expect(analyticsIdValidators.googleAds('AW-123456')).toBe(true);
    expect(analyticsIdValidators.googleAds('AW-ABC')).toBe(false);
  });

  it('disables invalid IDs without throwing', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true';
    process.env.NEXT_PUBLIC_GTM_CONTAINER_ID = 'javascript:alert(1)';
    const config = getPublicAnalyticsConfig();
    expect(config.gtmContainerId).toBeNull();
    expect(isProductionAnalyticsRuntime(config, {
      nodeEnv: 'production',
      vercelEnv: 'production',
    })).toBe(false);
  });

  it('requires production and the configured hostname', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true';
    process.env.NEXT_PUBLIC_GTM_CONTAINER_ID = 'GTM-ABC123';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.yeosonam.com';
    const config = getPublicAnalyticsConfig();
    expect(isProductionAnalyticsRuntime(config, {
      nodeEnv: 'production',
      vercelEnv: 'production',
      hostname: 'www.yeosonam.com',
    })).toBe(true);
    expect(isProductionAnalyticsRuntime(config, {
      nodeEnv: 'production',
      vercelEnv: 'preview',
      hostname: 'www.yeosonam.com',
    })).toBe(false);
  });
});
