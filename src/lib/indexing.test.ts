import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIndexNowRuntimeStateForTests, notifyIndexingBatch } from './indexing';
import { requestGoogleIndexing, submitGoogleSitemap } from './gsc-client';

vi.mock('./gsc-client', () => ({
  requestGoogleIndexing: vi.fn(async (url: string) => ({ url, ok: true })),
  submitGoogleSitemap: vi.fn(async (sitemapUrl: string) => ({ ok: true, sitemapUrl })),
}));

describe('notifyIndexingBatch', () => {
  const validIndexNowKey = 'deadbeef';
  const originalIndexNowKey = process.env.INDEXNOW_KEY;
  const originalGoogleIndexingFlag = process.env.GOOGLE_INDEXING_API_FOR_BLOGS;
  const originalIndexNowRecentTtl = process.env.INDEXNOW_RECENT_TTL_MS;
  const originalIndexNowMinInterval = process.env.INDEXNOW_PROVIDER_MIN_INTERVAL_MS;
  const originalIndexNowMaxUrls = process.env.INDEXNOW_MAX_URLS_PER_REQUEST;

  beforeEach(() => {
    vi.clearAllMocks();
    clearIndexNowRuntimeStateForTests();
    process.env.INDEXNOW_KEY = validIndexNowKey;
    process.env.INDEXNOW_PROVIDER_MIN_INTERVAL_MS = '0';
    process.env.INDEXNOW_RECENT_TTL_MS = String(10 * 60 * 1000);
    delete process.env.INDEXNOW_MAX_URLS_PER_REQUEST;
    delete process.env.GOOGLE_INDEXING_API_FOR_BLOGS;
    global.fetch = vi.fn(async () => new Response(null, { status: 202 }));
  });

  afterEach(() => {
    clearIndexNowRuntimeStateForTests();

    if (originalIndexNowKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalIndexNowKey;

    if (originalGoogleIndexingFlag === undefined) delete process.env.GOOGLE_INDEXING_API_FOR_BLOGS;
    else process.env.GOOGLE_INDEXING_API_FOR_BLOGS = originalGoogleIndexingFlag;

    if (originalIndexNowRecentTtl === undefined) delete process.env.INDEXNOW_RECENT_TTL_MS;
    else process.env.INDEXNOW_RECENT_TTL_MS = originalIndexNowRecentTtl;

    if (originalIndexNowMinInterval === undefined) delete process.env.INDEXNOW_PROVIDER_MIN_INTERVAL_MS;
    else process.env.INDEXNOW_PROVIDER_MIN_INTERVAL_MS = originalIndexNowMinInterval;

    if (originalIndexNowMaxUrls === undefined) delete process.env.INDEXNOW_MAX_URLS_PER_REQUEST;
    else process.env.INDEXNOW_MAX_URLS_PER_REQUEST = originalIndexNowMaxUrls;
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
      key: validIndexNowKey,
      urlList: urls,
    });
    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.google === 'success')).toBe(true);
  });

  it('never uses direct Google Indexing API for ordinary blog URLs even if the retired flag remains set', async () => {
    process.env.GOOGLE_INDEXING_API_FOR_BLOGS = 'true';

    await notifyIndexingBatch(['https://www.yeosonam.com/blog/test'], 'https://www.yeosonam.com');

    expect(requestGoogleIndexing).not.toHaveBeenCalled();
  });

  it('skips IndexNow when the key is not configured', async () => {
    delete process.env.INDEXNOW_KEY;

    const reports = await notifyIndexingBatch(['https://www.yeosonam.com/blog/test'], 'https://www.yeosonam.com');

    expect(fetch).not.toHaveBeenCalled();
    expect(reports[0]?.indexnow).toBe('skipped');
    expect(reports[0]?.indexnow_error).toBe('INDEXNOW_KEY 미설정');
  });

  it('fails closed before provider calls when the key is not Naver-compatible', async () => {
    process.env.INDEXNOW_KEY = 'test-indexnow-key_123';

    const reports = await notifyIndexingBatch(
      ['https://www.yeosonam.com/blog/test'],
      'https://www.yeosonam.com',
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(reports[0]?.indexnow).toBe('failed');
    expect(reports[0]?.indexnow_error).toBe('INDEXNOW_KEY_invalid_naver_shape');
  });

  it('does not resubmit recently submitted IndexNow URLs in the same runtime', async () => {
    const url = 'https://www.yeosonam.com/blog/recently-submitted';

    await notifyIndexingBatch([url], 'https://www.yeosonam.com');
    vi.mocked(fetch).mockClear();

    const reports = await notifyIndexingBatch([url], 'https://www.yeosonam.com');

    expect(fetch).not.toHaveBeenCalled();
    expect(reports[0]?.indexnow).toBe('skipped');
    expect(reports[0]?.indexnow_error).toBe('recent_indexnow_submission_cached');
  });

  it('always submits URL_DELETED even when the URL was recently submitted', async () => {
    const url = 'https://www.yeosonam.com/blog/deleted-post';

    await notifyIndexingBatch([url], 'https://www.yeosonam.com');
    vi.mocked(fetch).mockClear();

    const reports = await notifyIndexingBatch([url], 'https://www.yeosonam.com', { type: 'URL_DELETED' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reports[0]?.indexnow).toBe('success');
  });

  it('splits IndexNow batches by the configured request size', async () => {
    process.env.INDEXNOW_MAX_URLS_PER_REQUEST = '1';
    const urls = [
      'https://www.yeosonam.com/blog/batch-a',
      'https://www.yeosonam.com/blog/batch-b',
    ];

    await notifyIndexingBatch(urls, 'https://www.yeosonam.com');

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)).urlList)).toEqual([
      [urls[0]],
      [urls[0]],
      [urls[1]],
      [urls[1]],
    ]);
  });

  it('keeps IndexNow Retry-After evidence when providers rate-limit a batch', async () => {
    global.fetch = vi.fn(async () => new Response(null, {
      status: 429,
      headers: { 'Retry-After': '120' },
    }));

    const reports = await notifyIndexingBatch(
      ['https://www.yeosonam.com/blog/rate-limited'],
      'https://www.yeosonam.com',
    );

    expect(reports[0]?.indexnow).toBe('failed');
    expect(reports[0]?.indexnow_error).toContain('retry_after_ms=120000');
    expect(reports[0]?.indexnow_retry_after_ms).toBe(120000);
  });

  it('does not call external services for an empty batch', async () => {
    const reports = await notifyIndexingBatch([], 'https://www.yeosonam.com');

    expect(reports).toEqual([]);
    expect(submitGoogleSitemap).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
