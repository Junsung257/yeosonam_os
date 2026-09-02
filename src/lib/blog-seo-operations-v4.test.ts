import { describe, expect, it } from 'vitest';

import {
  detectBlogCannibalizationV4,
  detectBlogContentDecayV4,
  detectBlogSeoDriftV4,
  evaluateBlogSeoSurfaceV4,
  evaluateKoreanSemanticBenchmarkV4,
  inspectBlogSeoSurfaceV4,
} from './blog-seo-operations-v4';

function healthyHtml(title = '오사카 가이드') {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="설명"><meta name="robots" content="index,follow"><link rel="canonical" href="https://www.yeosonam.com/blog/osaka"><script type="application/ld+json">{"@graph":[{"@type":"Article"},{"@type":"BreadcrumbList"}]}</script></head><body><h1>${title}</h1><p>독자에게 필요한 실제 내용입니다.</p></body></html>`;
}

describe('blog SEO operations V4', () => {
  it('inspects a healthy public surface without technical findings', () => {
    const observation = inspectBlogSeoSurfaceV4({
      url: 'https://www.yeosonam.com/blog/osaka', slug: 'osaka', html: healthyHtml(), httpStatus: 200, sitemapIncluded: true,
    });
    expect(evaluateBlogSeoSurfaceV4(observation)).toEqual([]);
    expect(observation.schemaTypes).toEqual(['Article', 'BreadcrumbList']);
  });

  it('fails closed for noindex, canonical mismatch, missing schema, and sitemap omission', () => {
    const html = '<html><head><title>x</title><meta name="robots" content="noindex"><link rel="canonical" href="https://evil.example/x"></head><body><h1>x</h1></body></html>';
    const codes = evaluateBlogSeoSurfaceV4(inspectBlogSeoSurfaceV4({
      url: 'https://www.yeosonam.com/blog/x', slug: 'x', html, httpStatus: 200, sitemapIncluded: false,
    })).map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['public_robots_noindex', 'canonical_mismatch', 'schema_article_missing', 'sitemap_missing_public_url']));
  });

  it('records metadata and rendered drift separately', () => {
    const previous = inspectBlogSeoSurfaceV4({ url: 'https://www.yeosonam.com/blog/osaka', slug: 'osaka', html: healthyHtml(), httpStatus: 200 });
    const current = inspectBlogSeoSurfaceV4({ url: previous.url, slug: 'osaka', html: healthyHtml('오사카 최신 가이드'), httpStatus: 200 });
    expect(detectBlogSeoDriftV4(current, previous).map((row) => row.category)).toEqual(['metadata_drift', 'render_drift']);
  });

  it('detects material query cannibalization across public slugs', () => {
    const rows = [
      { slug: 'a', query: '오사카 여행', date: '2026-08-30', impressions: 120, clicks: 5, position: 7 },
      { slug: 'b', query: '오사카 여행', date: '2026-08-30', impressions: 110, clicks: 4, position: 9 },
    ];
    expect(detectBlogCannibalizationV4(rows)).toMatchObject([{ category: 'cannibalization', severity: 'critical' }]);
  });

  it('detects 28-day content decay only with a material baseline', () => {
    const now = new Date('2026-09-02T00:00:00.000Z');
    const rows = [
      { slug: 'osaka', query: '__page__', date: '2026-07-20', impressions: 100, clicks: 10, position: 8 },
      { slug: 'osaka', query: '__page__', date: '2026-08-20', impressions: 30, clicks: 2, position: 15 },
      { slug: 'tiny', query: '__page__', date: '2026-07-20', impressions: 4, clicks: 0, position: 50 },
      { slug: 'tiny', query: '__page__', date: '2026-08-20', impressions: 0, clicks: 0, position: null },
    ];
    expect(detectBlogContentDecayV4(rows, now)).toMatchObject([{ slug: 'osaka', category: 'content_decay' }]);
  });

  it('requires both precision and recall 0.90 on at least 100 semantic fixtures', () => {
    expect(evaluateKoreanSemanticBenchmarkV4({ sampleSize: 100, precision: 0.9, recall: 0.9 }).passed).toBe(true);
    expect(evaluateKoreanSemanticBenchmarkV4({ sampleSize: 100, precision: 0.89, recall: 0.95 }).passed).toBe(false);
  });
});
