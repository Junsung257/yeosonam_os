import { describe, expect, it } from 'vitest';
import {
  buildBlogSearchFollowupRowsV4,
  decideBlogSearchFollowupV4,
  nextBlogSearchFollowupRetryV4,
} from './blog-search-followup-v4';

describe('blog search follow-up V4', () => {
  it('creates exactly one D+1, D+3, and D+7 job', () => {
    const rows = buildBlogSearchFollowupRowsV4({
      contentCreativeId: '11111111-1111-4111-8111-111111111111',
      slug: 'guam-guide',
      url: 'https://www.yeosonam.com/blog/guam-guide',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(rows.map((row) => row.milestone_days)).toEqual([1, 3, 7]);
    expect(rows.map((row) => row.due_at)).toEqual([
      '2026-09-02T00:00:00.000Z',
      '2026-09-04T00:00:00.000Z',
      '2026-09-08T00:00:00.000Z',
    ]);
  });

  it('resubmits Sitemap only once at D+3 when the URL is still undiscovered', () => {
    expect(decideBlogSearchFollowupV4({
      milestoneDays: 3,
      indexStatus: 'not_indexed',
      lifecycleStatus: 'received',
      inspectedUrl: 'https://www.yeosonam.com/blog/test',
    })).toMatchObject({ resubmitSitemap: true, outcome: 'completed' });
    expect(decideBlogSearchFollowupV4({
      milestoneDays: 3,
      indexStatus: 'not_indexed',
      lifecycleStatus: 'crawled',
      inspectedUrl: 'https://www.yeosonam.com/blog/test',
    }).resubmitSitemap).toBe(false);
  });

  it('escalates D+7 to a finite technical/content correction instead of looping', () => {
    expect(decideBlogSearchFollowupV4({
      milestoneDays: 7,
      indexStatus: 'blocked',
      lifecycleStatus: 'crawled',
      pageFetchState: 'BLOCKED_BY_ROBOTS_TXT',
      inspectedUrl: 'https://www.yeosonam.com/blog/test',
    })).toMatchObject({ outcome: 'escalated', correctionType: 'technical', resubmitSitemap: false });
    expect(decideBlogSearchFollowupV4({
      milestoneDays: 7,
      indexStatus: 'not_indexed',
      lifecycleStatus: 'crawled',
      pageFetchState: 'SUCCESSFUL',
      inspectedUrl: 'https://www.yeosonam.com/blog/test',
    })).toMatchObject({ outcome: 'escalated', correctionType: 'content' });
  });

  it('retries transient checks at most three times', () => {
    expect(nextBlogSearchFollowupRetryV4(0, new Date('2026-09-01T00:00:00Z'))).toMatchObject({
      attemptCount: 1, status: 'retry', nextAttemptAt: '2026-09-01T01:00:00.000Z',
    });
    expect(nextBlogSearchFollowupRetryV4(2).status).toBe('failed');
  });
});
