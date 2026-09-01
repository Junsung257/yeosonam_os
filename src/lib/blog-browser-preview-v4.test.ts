import { describe, expect, it } from 'vitest';
import {
  BLOG_BROWSER_PUBLIC_META_KEY,
  BLOG_BROWSER_PREVIEW_META_KEY,
  BLOG_BROWSER_PREVIEW_VERSION,
  createBlogPreviewContentHash,
  createBlogPreviewToken,
  readBlogBrowserPreviewEvidenceV4,
  readBlogBrowserPublicEvidenceV4,
  verifyBlogPreviewToken,
} from './blog-browser-preview-v4';

const creativeId = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-01T00:00:00.000Z');

describe('blog browser preview V4', () => {
  it('creates a short-lived slug-bound token', () => {
    const token = createBlogPreviewToken({ creativeId, slug: 'guam-guide', now, secret: 'test-secret' });
    expect(verifyBlogPreviewToken({ token, slug: 'guam-guide', now, secret: 'test-secret' }))
      .toMatchObject({ creativeId, slug: 'guam-guide' });
    expect(verifyBlogPreviewToken({ token, slug: 'other', now, secret: 'test-secret' })).toBeNull();
    expect(verifyBlogPreviewToken({
      token,
      slug: 'guam-guide',
      now: new Date(now.getTime() + 16 * 60 * 1_000),
      secret: 'test-secret',
    })).toBeNull();
  });

  it('accepts only versioned Playwright evidence', () => {
    expect(readBlogBrowserPreviewEvidenceV4({
      [BLOG_BROWSER_PREVIEW_META_KEY]: {
        version: BLOG_BROWSER_PREVIEW_VERSION,
        passed: true,
        score: 97,
        mobileScore: 96,
        desktopScore: 98,
        auditedAt: '2026-09-01T00:00:00.000Z',
        previewPath: '/blog/guam-guide?preview=redacted',
        issues: [],
        evaluator: 'playwright',
        contentHash: createBlogPreviewContentHash({ slug: 'guam-guide', markdown: '# 괌' }),
      },
    })).toMatchObject({ passed: true, score: 97 });
    expect(readBlogBrowserPreviewEvidenceV4({
      [BLOG_BROWSER_PREVIEW_META_KEY]: { version: 'legacy', passed: true, score: 100 },
    })).toBeNull();
  });

  it('keeps post-public browser evidence separate from the pre-public gate', () => {
    const evidence = {
      version: BLOG_BROWSER_PREVIEW_VERSION,
      passed: true,
      score: 100,
      mobileScore: 100,
      desktopScore: 100,
      auditedAt: now.toISOString(),
      previewPath: '/blog/guam-guide',
      issues: [],
      evaluator: 'playwright',
      contentHash: createBlogPreviewContentHash({ slug: 'guam-guide', markdown: '# 괌' }),
    };
    expect(readBlogBrowserPublicEvidenceV4({ [BLOG_BROWSER_PUBLIC_META_KEY]: evidence }))
      .toMatchObject({ passed: true, previewPath: '/blog/guam-guide' });
    expect(readBlogBrowserPreviewEvidenceV4({ [BLOG_BROWSER_PUBLIC_META_KEY]: evidence })).toBeNull();
  });
});
