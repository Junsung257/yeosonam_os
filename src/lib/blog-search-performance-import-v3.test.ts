import { describe, expect, it } from 'vitest';
import {
  buildBlogGscSearchPerformanceRowsV3,
  normalizeBlogSearchPerformanceRowV3,
} from './blog-search-performance-import-v3';

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

  it('uses stable dimension identity so an observed row can be updated instead of duplicated', () => {
    const first = normalizeBlogSearchPerformanceRowV3({
      provider: 'google_search_console', batchId: 'first',
      row: { date: '2026-08-10', query: '발리 7월 날씨', page: 'https://www.yeosonam.com/blog/bali-weather', clicks: '1', impressions: '100' },
    });
    const corrected = normalizeBlogSearchPerformanceRowV3({
      provider: 'google_search_console', batchId: 'corrected',
      row: { date: '2026-08-10', query: '발리 7월 날씨', page: 'https://www.yeosonam.com/blog/bali-weather', clicks: '2', impressions: '120' },
    });

    expect(corrected.source_row_hash).toBe(first.source_row_hash);
  });

  it('builds query-page-date GSC rows and never stores the page aggregate sentinel', () => {
    const rows = buildBlogGscSearchPerformanceRowsV3([{
      date: '2026-08-10',
      page: 'https://www.yeosonam.com/blog/bali-weather',
      query: '발리 7월 날씨', impressions: 324, clicks: 1, ctr: 1 / 324, position: 8.2,
    }], 'gsc-2026-08-10');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'google_search_console',
      metric_date: '2026-08-10',
      query: '발리 7월 날씨',
      page_url: 'https://www.yeosonam.com/blog/bali-weather',
    });
    expect(rows[0]?.query).not.toBe('__page__');
  });
});
