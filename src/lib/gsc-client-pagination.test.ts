import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class GoogleAuth {} },
    searchconsole: () => ({ searchanalytics: { query: queryMock } }),
  },
}));

vi.mock('@/lib/secret-registry', () => ({
  getSecret: () => JSON.stringify({ client_email: 'fixture@example.com', private_key: 'fixture' }),
}));

describe('GSC query-page collector pagination', () => {
  beforeEach(() => queryMock.mockReset());

  it('requests the documented 25k pages and preserves date/page/query dimensions', async () => {
    const firstPage = Array.from({ length: 25_000 }, (_, index) => ({
      keys: ['2026-08-10', `https://www.yeosonam.com/blog/post-${index}`, `query-${index}`],
      impressions: 1,
      clicks: 0,
      ctr: 0,
      position: 10,
    }));
    queryMock
      .mockResolvedValueOnce({ data: { rows: firstPage } })
      .mockResolvedValueOnce({ data: { rows: [{
        keys: ['2026-08-10', 'https://www.yeosonam.com/blog/final', 'final query'],
        impressions: 2, clicks: 1, ctr: 0.5, position: 4,
      }] } });
    const { fetchBlogSearchMetrics } = await import('./gsc-client');

    const rows = await fetchBlogSearchMetrics('sc-domain:yeosonam.com', '2026-08-10', true);

    expect(rows).toHaveLength(25_001);
    expect(rows.at(-1)).toMatchObject({
      date: '2026-08-10',
      page: 'https://www.yeosonam.com/blog/final',
      query: 'final query',
    });
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestBody: expect.objectContaining({
        dimensions: ['date', 'page', 'query'], rowLimit: 25_000, startRow: 0,
      }),
    }));
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestBody: expect.objectContaining({ rowLimit: 25_000, startRow: 25_000 }),
    }));
  });
});
