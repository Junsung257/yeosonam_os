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

  it('rechecks the canonical public source before an update notification', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-indexing-worker.ts'), 'utf8');
    const snapshotRefreshIndex = source.indexOf('await refreshBlogPublicSnapshotsForIndexingV3()');
    const eligibilityIndex = source.indexOf('isBlogIndexingJobPubliclyEligible(job)');
    const notifyIndex = source.indexOf('notifyIndexing(canonicalUrl, baseUrl, {');

    expect(source).toContain("rpc('refresh_blog_public_snapshots_v3')");
    expect(source).toContain("snapshot_refresh: 'failed'");
    expect(source).toContain('leave every outbox row unclaimed for a retry');
    expect(source).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
    expect(source).toContain("job.type === 'URL_DELETED'");
    expect(source).toContain("status: 'skipped'");
    expect(snapshotRefreshIndex).toBeGreaterThan(0);
    expect(snapshotRefreshIndex).toBeLessThan(eligibilityIndex);
    expect(eligibilityIndex).toBeGreaterThan(0);
    expect(eligibilityIndex).toBeLessThan(notifyIndex);
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
