import { describe, expect, it } from 'vitest';
import { evaluateBlogSearchRefreshOpportunityV4 } from './blog-search-refresh-opportunity-v4';

describe('blog search refresh opportunity V4', () => {
  it('never turns zero impressions into an automatic generation candidate', () => {
    expect(evaluateBlogSearchRefreshOpportunityV4([
      { impressions: 0, clicks: 0, position: null },
    ])).toMatchObject({
      eligible: false,
      reason: 'zero_impression_reconsider',
      impressions: 0,
    });
  });

  it('accepts observed position 4-20 as a representative refresh', () => {
    expect(evaluateBlogSearchRefreshOpportunityV4([
      { impressions: 80, clicks: 2, position: 8 },
      { impressions: 20, clicks: 1, position: 12 },
    ])).toMatchObject({
      eligible: true,
      reason: 'position_4_20_refresh',
      impressions: 100,
      clicks: 3,
      ctr: 0.03,
      averagePosition: 8.8,
    });
  });

  it('does not rewrite a page already ranking above the refresh band', () => {
    expect(evaluateBlogSearchRefreshOpportunityV4([
      { impressions: 120, clicks: 18, position: 2.5 },
    ])).toMatchObject({
      eligible: false,
      reason: 'position_not_refresh_band',
    });
  });
});
