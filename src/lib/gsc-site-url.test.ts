import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGscSearchSiteUrlCandidates, getCanonicalGscUrlProperty } from './gsc-site-url';

describe('gsc site url candidates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the canonical www property before a configured apex URL property', () => {
    vi.stubEnv('GSC_SITE_URL', 'https://yeosonam.com/');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.yeosonam.com');

    const candidates = buildGscSearchSiteUrlCandidates(process.env.GSC_SITE_URL);

    expect(candidates[0]).toBe('https://www.yeosonam.com/');
    expect(candidates).toContain('https://yeosonam.com/');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('keeps an explicit domain property first but still adds canonical URL fallbacks', () => {
    vi.stubEnv('GSC_SITE_URL', 'sc-domain:yeosonam.com');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.yeosonam.com');

    const candidates = buildGscSearchSiteUrlCandidates(process.env.GSC_SITE_URL);

    expect(candidates[0]).toBe('sc-domain:yeosonam.com');
    expect(candidates).toContain('https://www.yeosonam.com/');
    expect(candidates).toContain('https://yeosonam.com/');
  });

  it('does not use localhost as the canonical Search Console property', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'http://127.0.0.1:3000');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('BLOG_CANONICAL_ORIGIN', '');

    expect(getCanonicalGscUrlProperty()).toBe('https://www.yeosonam.com/');
  });
});
