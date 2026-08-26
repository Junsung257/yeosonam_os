import { describe, expect, it } from 'vitest';
import { readServerFeatureFlags } from './feature-flags';

describe('server feature flags', () => {
  it('keeps existing fail-safe defaults', () => {
    expect(readServerFeatureFlags({})).toEqual({
      jarvisStreamEnabled: true,
      irCanaryEnabled: false,
      irCanaryRolloutPct: 1,
      irCanaryMultiEnabled: true,
      irCanaryMaxProducts: 8,
      irCanaryConcurrency: 2,
    });
  });

  it('parses exact booleans and bounded rollout knobs', () => {
    expect(readServerFeatureFlags({
      JARVIS_STREAM_ENABLED: 'false',
      IR_CANARY_ENABLED: 'true',
      IR_CANARY_ROLLOUT_PCT: '120',
      IR_CANARY_MULTI: '0',
      IR_CANARY_MAX_PRODUCTS: '99',
      IR_CANARY_CONCURRENCY: '10',
    })).toEqual({
      jarvisStreamEnabled: false,
      irCanaryEnabled: true,
      irCanaryRolloutPct: 100,
      irCanaryMultiEnabled: false,
      irCanaryMaxProducts: 16,
      irCanaryConcurrency: 6,
    });
  });

  it('falls back safely for malformed numeric values', () => {
    const flags = readServerFeatureFlags({
      IR_CANARY_ROLLOUT_PCT: 'not-a-number',
      IR_CANARY_MAX_PRODUCTS: '0',
      IR_CANARY_CONCURRENCY: '-1',
    });

    expect(flags.irCanaryRolloutPct).toBe(1);
    expect(flags.irCanaryMaxProducts).toBe(8);
    expect(flags.irCanaryConcurrency).toBe(2);
  });
});
