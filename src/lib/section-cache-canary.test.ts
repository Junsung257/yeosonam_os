import { describe, expect, it } from 'vitest';
import { evaluateSectionCacheCanary } from './section-cache-canary';

describe('evaluateSectionCacheCanary', () => {
  it('collects more data before enough reduce-ready samples exist', () => {
    const result = evaluateSectionCacheCanary({
      totalRegistrations: 50,
      reduceReadyCount: 4,
      reducedChars: 0,
      qualityIncidentCount: 0,
      minReadySamples: 10,
    });

    expect(result.recommendation).toBe('collect_more_data');
    expect(result.reason).toContain('4/10');
  });

  it('requires investigation when quality incidents exceed the guardrail', () => {
    const result = evaluateSectionCacheCanary({
      totalRegistrations: 100,
      reduceReadyCount: 25,
      reducedChars: 0,
      qualityIncidentCount: 5,
      maxQualityIncidentRate: 0.02,
    });

    expect(result.recommendation).toBe('investigate_quality');
    expect(result.qualityIncidentRate).toBe(0.05);
  });

  it('allows enabling input-reduction canary when ready samples are sufficient and quality is clean', () => {
    const result = evaluateSectionCacheCanary({
      totalRegistrations: 40,
      reduceReadyCount: 12,
      reducedChars: 0,
      qualityIncidentCount: 0,
    });

    expect(result.recommendation).toBe('enable_reduce_input_canary');
  });

  it('continues canary once savings are measurable and quality remains clean', () => {
    const result = evaluateSectionCacheCanary({
      totalRegistrations: 40,
      reduceReadyCount: 12,
      reducedChars: 3000,
      qualityIncidentCount: 0,
    });

    expect(result.recommendation).toBe('continue_canary');
  });
});
