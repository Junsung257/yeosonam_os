import { describe, expect, it } from 'vitest';

import { evaluateBlogPublicEligibility } from './blog-public-eligibility';
import { BLOG_PUBLIC_ELIGIBILITY_FIXTURES } from './blog-public-eligibility-fixtures';

describe('SQL/TypeScript blog public eligibility contract fixtures', () => {
  it.each(BLOG_PUBLIC_ELIGIBILITY_FIXTURES)('$id', (fixture) => {
    expect(evaluateBlogPublicEligibility(fixture.row)).toMatchObject({
      eligible: fixture.expectedEligible,
      reason: fixture.expectedReason,
    });
  });
});
