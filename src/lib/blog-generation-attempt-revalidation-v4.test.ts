import { describe, expect, it } from 'vitest';
import { isEligibleBlogGenerationAttemptRevalidationV4 } from './blog-generation-run-v4';

const output = {
  title: '괌 식비 예산',
  description: '근거 기반 식비 비교',
  slug: 'guam-daily-food-budget',
  markdown: '# 괌 식비 예산\n\n식당 근거를 확인하세요.',
  audit: {
    claim_validation: { passed: true },
    publish_quality: { passed: true },
    quality_evaluation_v3: {
      passed: false,
      failureReasons: [{ code: 'opening_too_similar' }],
    },
  },
};

describe('deterministic blog generation attempt revalidation v4', () => {
  it('allows only an unchanged, grounded attempt blocked solely by opening similarity', () => {
    expect(isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: 5,
        status: 'completed',
        route: 'quarantine',
        qualityScore: 96.52,
        hardBlockers: [],
        failureReasons: ['opening_too_similar'],
        output,
      },
      expectedAttemptNumber: 5,
      output,
    })).toBe(true);
  });

  it('rejects content changes and any additional failure', () => {
    expect(isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: 5,
        status: 'completed',
        route: 'quarantine',
        qualityScore: 96.52,
        hardBlockers: [],
        failureReasons: ['opening_too_similar', 'unsupported_number_present'],
        output,
      },
      expectedAttemptNumber: 5,
      output: { ...output, markdown: `${output.markdown}\n\n새 문장` },
    })).toBe(false);
  });
});
