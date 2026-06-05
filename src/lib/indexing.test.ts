import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyIndexingBatch } from './indexing';
import { requestGoogleIndexing, submitGoogleSitemap } from './gsc-client';

vi.mock('./gsc-client', () => ({
  requestGoogleIndexing: vi.fn(async (url: string) => ({ url, ok: true })),
  submitGoogleSitemap: vi.fn(async (sitemapUrl: string) => ({ ok: true, sitemapUrl })),
}));

describe('notifyIndexingBatch', () => {
  const originalIndexNowKey = process.env.INDEXNOW_KEY;
  const originalGoogleIndexingFlag = process.env.GOOGLE_INDEXING_API_FOR_BLOGS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INDEXNOW_KEY = 'test-indexnow-key';
    delete process.env.GOOGLE_INDEXING_API_FOR_BLOGS;
    global.fetch = vi.fn(async () => new Response(null, { status: 202 }));
  });

  afterEach(() => {
    if (originalIndexNowKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalIndexNowKey;

    if (originalGoogleIndexingFlag === undefined) delete process.env.GOOGLE_INDEXING_API_FOR_BLOGS;
    else process.env.GOOGLE_INDEXING_API_FOR_BLOGS = originalGoogleIndexingFlag;
  });

  it('uses one Google sitemap submit and one IndexNow batch for blog URLs', async () => {
    const urls = [
      'https://www.yeosonam.com/blog/da-nang-family',
      'https://www.yeosonam.com/blog/cebu-guide',
    ];

    const reports = await notifyIndexingBatch(urls, 'https://www.yeosonam.com');

    expect(submitGoogleSitemap).toHaveBeenCalledTimes(1);
    expect(requestGoogleIndexing).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      host: 'www.yeosonam.com',
      key: 'test-indexnow-key',
      urlList: urls,
    });
    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.google === 'success')).toBe(true);
  });

  it('allows direct Google Indexing API only when explicitly enabled', async () => {
    process.env.GOOGLE_INDEXING_API_FOR_BLOGS = 'true';

    await notifyIndexingBatch(['https://www.yeosonam.com/blog/test'], 'https://www.yeosonam.com');

    expect(requestGoogleIndexing).toHaveBeenCalledTimes(1);
  });

  it('skips IndexNow when the key is not configured', async () => {
    delete process.env.INDEXNOW_KEY;

    const reports = await notifyIndexingBatch(['https://www.yeosonam.com/blog/test'], 'https://www.yeosonam.com');

    expect(fetch).not.toHaveBeenCalled();
    expect(reports[0]?.indexnow).toBe('skipped');
    expect(reports[0]?.indexnow_error).toBe('INDEXNOW_KEY 미설정');
  });

  it('does not call external services for an empty batch', async () => {
    const reports = await notifyIndexingBatch([], 'https://www.yeosonam.com');

    expect(reports).toEqual([]);
    expect(submitGoogleSitemap).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
