import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBlogIndexingBaseUrl } from './blog-indexing-worker';
import { isIndexingReportSuccessful } from './blog-indexing-outbox';

describe('blog indexing worker', () => {
  it('prefers the public job URL origin over localhost options', () => {
    expect(resolveBlogIndexingBaseUrl(
      'https://www.yeosonam.com/blog/6-fukuoka',
      'http://localhost:3000',
    )).toBe('https://www.yeosonam.com');
  });

  it('uses an explicit public base URL when provided', () => {
    expect(resolveBlogIndexingBaseUrl(
      'https://preview.example.com/blog/6-fukuoka',
      'https://www.yeosonam.com',
    )).toBe('https://www.yeosonam.com');
  });

  it('keeps durable blog outbox submissions on GSC sitemap and IndexNow without legacy pings', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-indexing-worker.ts'), 'utf8');

    expect(source).toContain('notifyIndexing(canonicalUrl, baseUrl, {');
    expect(source).toContain('pingSitemap: false');
    expect(source).toContain('indexnow_retry_after_ms');
    expect(source).toContain('Math.max(retryDelayMs(attempt), providerRetryAfterMs ?? 0)');
  });

  it('does not mark a configured IndexNow failure as complete just because sitemap succeeded', () => {
    expect(isIndexingReportSuccessful({
      url: 'https://www.yeosonam.com/blog/rate-limited',
      google: 'success',
      indexnow: 'failed',
      indexnow_error: 'global HTTP 429 retry_after_ms=120000',
      indexnow_retry_after_ms: 120000,
      sitemap_pings: [{ provider: 'google_search_console_sitemap', ok: true }],
      duration_ms: 50,
    })).toBe(false);
  });
});
