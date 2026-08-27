import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { aggregateBlogSearchDemandRowsV4 } from './materializer';

function row(overrides: Record<string, unknown> = {}) {
  const query = String(overrides.query ?? '다낭 10월 날씨');
  const metricDate = String(overrides.metric_date ?? '2026-08-18');
  return {
    id: `${metricDate}:${query}`,
    provider: 'google_search_console',
    metric_date: metricDate,
    query,
    page_url: 'https://www.yeosonam.com/blog/danang-weather',
    clicks: 0,
    impressions: 0,
    ctr: 0,
    average_position: 8,
    imported_at: '2026-08-19T00:00:00.000Z',
    source_row_hash: createHash('sha256').update(`${metricDate}:${query}`).digest('hex'),
    ...overrides,
  };
}

describe('Blog V4 search demand aggregation', () => {
  it('clusters normalized query variants and sums observed metrics', () => {
    const result = aggregateBlogSearchDemandRowsV4([
      row({ query: '다낭 10월 날씨', clicks: 2, impressions: 100, average_position: 8 }),
      row({ query: '다낭 10월 날씨 2026', metric_date: '2026-08-17', clicks: 1, impressions: 50, average_position: 5 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.normalizedQuery).toBe('다낭 10월 날씨');
    expect(result[0]?.signal.metrics).toMatchObject({
      clicks: 3, impressions: 150, ctr: 0.02, page_count: 1, cannibalization_penalty: 0,
    });
    expect(Number(result[0]?.signal.metrics?.average_position)).toBeCloseTo(7, 6);
  });

  it('does not turn a zero-observation search row into demand', () => {
    expect(aggregateBlogSearchDemandRowsV4([row()])).toEqual([]);
  });
});
