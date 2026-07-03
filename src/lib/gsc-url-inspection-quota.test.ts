import { describe, expect, it } from 'vitest';
import {
  buildUrlInspectionQuotaState,
  isUrlInspectionQuotaError,
} from './gsc-url-inspection-quota';

describe('gsc-url-inspection-quota', () => {
  it('caps inspections by per-run and remaining rolling windows', () => {
    const quota = buildUrlInspectionQuotaState({
      requestedLimit: 40,
      last10mCount: 7,
      last24hCount: 20,
      maxPerRun: 25,
      maxPer10m: 30,
      maxPerDay: 100,
    });

    expect(quota.allowed).toBe(true);
    expect(quota.effectiveLimit).toBe(23);
    expect(quota.reason).toBe('allowed');
    expect(quota.remaining10m).toBe(23);
    expect(quota.remaining24h).toBe(80);
  });

  it('skips inspections when the 10 minute budget is exhausted', () => {
    const quota = buildUrlInspectionQuotaState({
      requestedLimit: 5,
      last10mCount: 100,
      last24hCount: 100,
      maxPerRun: 25,
      maxPer10m: 100,
      maxPerDay: 1500,
    });

    expect(quota.allowed).toBe(false);
    expect(quota.effectiveLimit).toBe(0);
    expect(quota.reason).toBe('per_10m_exhausted');
  });

  it('skips inspections when the daily budget is exhausted', () => {
    const quota = buildUrlInspectionQuotaState({
      requestedLimit: 5,
      last10mCount: 0,
      last24hCount: 1500,
      maxPerRun: 25,
      maxPer10m: 100,
      maxPerDay: 1500,
    });

    expect(quota.allowed).toBe(false);
    expect(quota.effectiveLimit).toBe(0);
    expect(quota.reason).toBe('daily_exhausted');
  });

  it('detects quota and rate-limit errors from URL Inspection responses', () => {
    expect(isUrlInspectionQuotaError('HTTP 429: Too Many Requests')).toBe(true);
    expect(isUrlInspectionQuotaError('RESOURCE_EXHAUSTED quota exceeded')).toBe(true);
    expect(isUrlInspectionQuotaError('rateLimitExceeded')).toBe(true);
    expect(isUrlInspectionQuotaError('HTTP 403: permission denied')).toBe(false);
  });
});
