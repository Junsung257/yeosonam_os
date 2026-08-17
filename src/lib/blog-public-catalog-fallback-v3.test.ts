import { describe, expect, it } from 'vitest';
import {
  isBlogPublicCatalogFallbackFreshV3,
  resolveBlogPublicCatalogFallbackV3,
  type PublicBlogCatalogPost,
} from './blog-public-catalog';

const base: PublicBlogCatalogPost = {
  id: '10000000-0000-4000-8000-000000000001',
  slug: 'danang-neighborhoods',
  seo_title: '다낭 숙소 지역 선택',
  seo_description: null,
  og_image_url: null,
  angle_type: 'neighborhood_selector',
  category: 'planning',
  published_at: '2026-08-01T00:00:00.000Z',
  updated_at: null,
  product_id: null,
  destination: '다낭',
  content_type: 'informational',
  featured: false,
  featured_order: null,
  view_count: null,
  review_status: 'none',
};

describe('public catalog fallback freshness', () => {
  it('allows LOW for 30 days and MEDIUM for only 48 hours', () => {
    const now = new Date('2026-08-16T00:00:00.000Z');
    expect(isBlogPublicCatalogFallbackFreshV3(base, '2026-08-01T00:00:00.000Z', now)).toBe(true);
    const medium = {
      ...base,
      slug: 'danang-october-weather',
      seo_title: '다낭 10월 날씨',
      generation_meta: { content_brief: { risk_level: 'MEDIUM' } },
    };
    expect(isBlogPublicCatalogFallbackFreshV3(medium, '2026-08-14T01:00:00.000Z', now)).toBe(true);
    expect(isBlogPublicCatalogFallbackFreshV3(medium, '2026-08-13T23:00:00.000Z', now)).toBe(false);
  });

  it('never serves HIGH-risk catalog rows from stale storage', () => {
    expect(isBlogPublicCatalogFallbackFreshV3({
      ...base,
      slug: 'etias-entry-change',
      seo_title: 'ETIAS 입국 규정 변경',
      review_status: 'approved',
      generation_meta: { content_brief: { risk_level: 'HIGH' } },
    }, '2026-08-15T23:59:00.000Z', new Date('2026-08-16T00:00:00.000Z'))).toBe(false);
  });
});

describe('public catalog fallback hierarchy', () => {
  it('continues to the remote snapshot when the durable database snapshot rejects', async () => {
    await expect(resolveBlogPublicCatalogFallbackV3({
      durable: async () => { throw new Error('database timeout'); },
      remote: async () => 'remote',
      bundled: () => 'bundled',
    })).resolves.toBe('remote');
  });

  it('always reaches the bundled snapshot when both upstream tiers reject', async () => {
    await expect(resolveBlogPublicCatalogFallbackV3({
      durable: async () => { throw new Error('database timeout'); },
      remote: async () => { throw new Error('remote timeout'); },
      bundled: () => 'bundled',
    })).resolves.toBe('bundled');
  });

  it('prefers the durable snapshot when it is available', async () => {
    let remoteCalled = false;
    await expect(resolveBlogPublicCatalogFallbackV3({
      durable: async () => 'durable',
      remote: async () => { remoteCalled = true; return 'remote'; },
      bundled: () => 'bundled',
    })).resolves.toBe('durable');
    expect(remoteCalled).toBe(false);
  });
});
