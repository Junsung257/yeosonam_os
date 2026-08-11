import { describe, expect, it } from 'vitest';
import { normalizeBlogSearchPerformanceRowV3 } from './blog-search-performance-import-v3';

describe('search performance import V3', () => {
  it('normalizes an observed Naver Search Advisor row without inventing search volume', () => {
    const row = normalizeBlogSearchPerformanceRowV3({
      provider: 'naver_search_advisor', batchId: 'batch-1',
      row: { 날짜: '2026-08-10', 검색어: '오사카 숙소 위치', URL: 'https://www.yeosonam.com/blog/osaka-hotel', 클릭수: '3', 노출수: '100', 클릭률: '3%' },
    });
    expect(row).toMatchObject({ clicks: 3, impressions: 100, ctr: 0.03, average_position: null });
    expect(row.source_row_hash).toHaveLength(64);
    expect(row).not.toHaveProperty('monthly_search_volume');
  });

  it('rejects inconsistent or synthetic-looking metrics', () => {
    expect(() => normalizeBlogSearchPerformanceRowV3({
      provider: 'google_search_console', batchId: 'bad',
      row: { date: '2026-08-10', query: 'x', page: 'https://www.yeosonam.com/blog/x', clicks: '20', impressions: '10', ctr: '2' },
    })).toThrow('metric_inconsistent');
  });
});
