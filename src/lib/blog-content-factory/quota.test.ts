import { describe, expect, it } from 'vitest';

import {
  BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4,
  cumulativeBlogContentFactorySlotCapsV4,
  evaluateBlogContentFactoryQuotaV4,
} from './quota';

describe('Blog V4 content factory quota', () => {
  it('pins rollout total and new-URL caps to 3/2, 10/6 and 30/18', () => {
    expect(BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4.pilot_3).toMatchObject({ totalOperations: 3, newUrls: 2 });
    expect(BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4.ramp_10).toMatchObject({ totalOperations: 10, newUrls: 6 });
    expect(BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4.max_30).toMatchObject({ totalOperations: 30, newUrls: 18 });
  });

  it('uses the lower environment cap and refuses to overfill it', () => {
    const result = evaluateBlogContentFactoryQuotaV4({
      stage: 'max_30',
      environmentDailyCap: 7,
      counts: { totalOperations: 7, newUrls: 4, byType: { new_info: 4 } },
      candidateType: 'material_refresh',
      candidateCreatesNewUrl: false,
    });
    expect(result).toMatchObject({ allowed: false, effectiveTotalCap: 7, effectiveNewUrlCap: 7 });
    expect(result.reasons).toContain('daily_operation_cap_reached');
  });

  it('does not use refresh capacity to exceed the new URL cap', () => {
    const result = evaluateBlogContentFactoryQuotaV4({
      stage: 'pilot_3',
      environmentDailyCap: 30,
      counts: { totalOperations: 2, newUrls: 2, byType: { new_info: 2 } },
      candidateType: 'new_commercial',
      candidateCreatesNewUrl: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('daily_new_url_cap_reached');
  });

  it('limits max-30 to three operations per one of ten cumulative slots', () => {
    expect(cumulativeBlogContentFactorySlotCapsV4('max_30')).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });
});
