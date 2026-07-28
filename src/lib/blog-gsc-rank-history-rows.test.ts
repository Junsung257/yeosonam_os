import { describe, expect, it } from 'vitest';
import { buildBlogGscQueryRankHistoryRows } from './blog-gsc-rank-history-rows';

describe('GSC query rank history rows', () => {
  it('merges duplicate canonical keys before the database upsert', () => {
    const rows = buildBlogGscQueryRankHistoryRows([
      {
        page: 'https://www.yeosonam.com/blog/cebu-weather',
        query: '세부 날씨',
        impressions: 10,
        clicks: 2,
        ctr: 0.2,
        position: 4,
        date: '2026-07-26',
      },
      {
        page: 'https://yeosonam.com/blog/cebu-weather',
        query: '세부 날씨',
        impressions: 30,
        clicks: 3,
        ctr: 0.1,
        position: 8,
        date: '2026-07-26',
      },
    ], '2026-07-26');

    expect(rows).toEqual([{
      slug: 'cebu-weather',
      query: '세부 날씨',
      date: '2026-07-26',
      position: 7,
      impressions: 40,
      clicks: 5,
      ctr: 0.125,
      page_url: 'https://www.yeosonam.com/blog/cebu-weather',
      source: 'gsc',
    }]);
  });

  it('keeps different queries separate and skips unusable keys', () => {
    const rows = buildBlogGscQueryRankHistoryRows([
      {
        page: 'https://www.yeosonam.com/blog/cebu-weather',
        query: '세부 날씨',
        impressions: 1,
        clicks: 0,
        ctr: 0,
        position: 10,
        date: '2026-07-26',
      },
      {
        page: 'https://www.yeosonam.com/blog/cebu-weather',
        query: '세부 옷차림',
        impressions: 2,
        clicks: 1,
        ctr: 0.5,
        position: 5,
        date: '2026-07-26',
      },
      {
        page: 'https://www.yeosonam.com/not-blog',
        query: null,
        impressions: 1,
        clicks: 0,
        ctr: 0,
        position: 1,
        date: '2026-07-26',
      },
    ], '2026-07-26');

    expect(rows.map((row) => row.query)).toEqual(['세부 날씨', '세부 옷차림']);
  });
});
