import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  blogIndexingUrlForSlug,
  canonicalizeBlogIndexingJobUrl,
  resolveBlogCanonicalOrigin,
} from './blog-canonical-url';

const ORIGINAL_ENV = {
  BLOG_CANONICAL_ORIGIN: process.env.BLOG_CANONICAL_ORIGIN,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

function restoreEnv(key: keyof typeof ORIGINAL_ENV) {
  const value = ORIGINAL_ENV[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('blog canonical URL helpers', () => {
  beforeEach(() => {
    delete process.env.BLOG_CANONICAL_ORIGIN;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    restoreEnv('BLOG_CANONICAL_ORIGIN');
    restoreEnv('NEXT_PUBLIC_BASE_URL');
    restoreEnv('NEXT_PUBLIC_SITE_URL');
  });

  it('falls back to the public www blog origin instead of non-canonical hosts', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';

    expect(resolveBlogCanonicalOrigin()).toBe('https://www.yeosonam.com');
    expect(blogIndexingUrlForSlug('/cebu-july-weather-clothes-checklist-2026/')).toBe(
      'https://www.yeosonam.com/blog/cebu-july-weather-clothes-checklist-2026',
    );
  });

  it('uses BLOG_CANONICAL_ORIGIN before generic public base URLs', () => {
    process.env.BLOG_CANONICAL_ORIGIN = 'https://www.yeosonam.com/';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://yeosonam.com';

    expect(resolveBlogCanonicalOrigin()).toBe('https://www.yeosonam.com');
  });

  it('normalizes the bare production domain to the www blog canonical origin', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://yeosonam.com';

    expect(resolveBlogCanonicalOrigin()).toBe('https://www.yeosonam.com');
  });

  it('rewrites existing non-www or stale blog indexing job URLs to the canonical slug URL', () => {
    process.env.BLOG_CANONICAL_ORIGIN = 'https://www.yeosonam.com';

    expect(canonicalizeBlogIndexingJobUrl({
      url: 'https://yeosonam.com/blog/travel-guide-q35bf6ed0',
      slug: 'july-family-travel-weather-clothes-checklist-2026',
    })).toBe('https://www.yeosonam.com/blog/july-family-travel-weather-clothes-checklist-2026');
  });
});
