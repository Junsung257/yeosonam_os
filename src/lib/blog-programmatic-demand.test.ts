import { describe, expect, it } from 'vitest';
import {
  hasObservedProgrammaticKeywordDemand,
  selectDailyProgrammaticDemandProbe,
} from './blog-programmatic-demand';

describe('programmatic SEO demand probe', () => {
  it('accepts only observed positive search volume or trend signals', () => {
    expect(hasObservedProgrammaticKeywordDemand(null)).toBe(false);
    expect(hasObservedProgrammaticKeywordDemand({ monthly_search_volume: null, trend_score: 0 })).toBe(false);
    expect(hasObservedProgrammaticKeywordDemand({ monthly_search_volume: 10, trend_score: null })).toBe(true);
    expect(hasObservedProgrammaticKeywordDemand({ monthly_search_volume: null, trend_score: 1 })).toBe(true);
  });

  it('rotates a bounded daily probe across a larger pending corpus', () => {
    const candidates = Array.from({ length: 100 }, (_, id) => ({ id }));
    const first = selectDailyProgrammaticDemandProbe(candidates, {
      limit: 5,
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
    const second = selectDailyProgrammaticDemandProbe(candidates, {
      limit: 5,
      now: new Date('2026-09-02T00:00:00.000Z'),
    });

    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    expect(first.map(row => row.id)).not.toEqual(second.map(row => row.id));
    expect(new Set(first.map(row => row.id)).size).toBe(first.length);
  });
});
