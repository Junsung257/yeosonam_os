import { describe, expect, it } from 'vitest';
import {
  BLOG_KOREAN_SEMANTIC_VERSION_V4,
  buildKoreanSemanticGoldenFixturesV4,
  evaluateKoreanSemanticFixturesV4,
  isKoreanSemanticBenchmarkPassingV4,
} from './blog-korean-semantic-v4';

describe('Korean semantic duplicate V4', () => {
  it('meets the 100-case precision and recall activation contract', () => {
    const result = evaluateKoreanSemanticFixturesV4(buildKoreanSemanticGoldenFixturesV4());
    expect(result.sampleSize).toBe(100);
    expect(result.precision).toBeGreaterThanOrEqual(0.9);
    expect(result.recall).toBeGreaterThanOrEqual(0.9);
    expect(result.passed).toBe(true);
  });

  it('fails closed on stale, self-declared, or undersized benchmark rows', () => {
    const passing = { adapter: 'korean_semantic' as const, adapter_version: BLOG_KOREAN_SEMANTIC_VERSION_V4, sample_size: 100, precision: 0.95, recall: 0.92, passed: true };
    expect(isKoreanSemanticBenchmarkPassingV4(passing)).toBe(true);
    expect(isKoreanSemanticBenchmarkPassingV4({ ...passing, sample_size: 99 })).toBe(false);
    expect(isKoreanSemanticBenchmarkPassingV4({ ...passing, adapter_version: 'old' })).toBe(false);
  });
});
