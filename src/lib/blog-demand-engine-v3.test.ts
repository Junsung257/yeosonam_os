import { describe, expect, it } from 'vitest';
import { assertImportedMetricIsObserved, scoreBlogDemandCandidateV3 } from './blog-demand-engine-v3';

describe('blog demand engine v3', () => {
  it('blocks coverage gap without any observed demand', () => {
    expect(scoreBlogDemandCandidateV3({
      demand: { monthlySearchVolume: null, trendScore: null },
    })).toEqual({
      eligible: false,
      score: null,
      components: {},
      reasons: ['verified_demand_signal_missing'],
    });
  });

  it('lets any verified signal enter ranking without an arbitrary score cutoff', () => {
    const result = scoreBlogDemandCandidateV3({
      demand: { customerQuestionCount: 1 },
      customerQuestionFrequency: 1,
      templateSaturationPenalty: 0.8,
    });
    expect(result.eligible).toBe(true);
    expect(result.score).not.toBeNull();
  });

  it('does not treat an empty provider response as success', () => {
    expect(() => assertImportedMetricIsObserved({
      provider: 'google_search_console', value: null, observed: false,
    })).toThrow('demand_metric_missing:google_search_console');
  });
});
