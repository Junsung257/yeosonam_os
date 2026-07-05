import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkPublicBlogSurfaces } from './blog-public-surface-check';

function htmlFor(url: string, options: { title?: string; canonical?: string } = {}): string {
  const title = options.title ?? '여행 매거진 | 여소남';
  const canonical = options.canonical ?? url;
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical}" /></head><body><a href="/blog/sample-post">sample</a></body></html>`;
}

function stubSurfaceFetch(overrides: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.pathname === '/sitemap.xml') {
      return new Response([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset>',
        '<url><loc>https://example.com/blog/sample-post</loc></url>',
        '<url><loc>https://example.com/blog/destination/bali</loc></url>',
        '<url><loc>https://example.com/blog/angle/value</loc></url>',
        '</urlset>',
      ].join(''), { status: 200 });
    }
    return new Response(overrides[parsed.pathname] ?? htmlFor(url), { status: 200 });
  }));
}

describe('blog public surface check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails a public section with duplicate Yeosonam brand in the HTML title', async () => {
    stubSurfaceFetch({
      '/blog/angle/value': htmlFor('https://example.com/blog/angle/value', {
        title: '가성비 여행 가이드 | 여소남 | 여소남',
      }),
    });

    const report = await checkPublicBlogSurfaces({
      baseUrl: 'https://example.com',
      slug: 'sample-post',
      destination: 'bali',
      includeDiagnostics: false,
    });

    expect(report.ok).toBe(false);
    expect(report.results.find((row) => row.id === 'blog-angle-value')?.issues).toContain('duplicate_brand_title');
  });

  it('fails a public section whose canonical URL does not match the requested surface', async () => {
    stubSurfaceFetch({
      '/blog/destination/bali': htmlFor('https://example.com/blog/destination/bali', {
        canonical: 'https://example.com/destinations/bali',
      }),
    });

    const report = await checkPublicBlogSurfaces({
      baseUrl: 'https://example.com',
      slug: 'sample-post',
      destination: 'bali',
      includeDiagnostics: false,
    });

    expect(report.ok).toBe(false);
    expect(report.results.find((row) => row.id === 'blog-destination')?.issues).toContain('canonical_mismatch');
  });
});
