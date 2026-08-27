import { describe, expect, it } from 'vitest';

import type { PublicBlogCatalogPost } from '@/lib/blog-public-catalog';
import { isCurrentCustomerGuide, selectCurrentCustomerGuides } from './customer-guide-selection';

function post(overrides: Partial<PublicBlogCatalogPost>): PublicBlogCatalogPost {
  return {
    id: 'guide-1',
    slug: 'guide-1',
    seo_title: '부산 출발 패키지 비교 방법',
    seo_description: null,
    og_image_url: null,
    angle_type: 'decision',
    category: 'package',
    published_at: '2026-08-20T00:00:00.000Z',
    updated_at: null,
    product_id: null,
    destination: null,
    content_type: 'guide',
    featured: false,
    featured_order: null,
    view_count: null,
    ...overrides,
  };
}

describe('customer guide selection', () => {
  const now = new Date('2026-08-24T03:00:00.000Z');

  it('excludes stale month, stale year and old posts from customer discovery', () => {
    expect(isCurrentCustomerGuide(post({ seo_title: '런던 7월 날씨' }), now)).toBe(false);
    expect(isCurrentCustomerGuide(post({ seo_title: '2025년 다낭 비용' }), now)).toBe(false);
    expect(isCurrentCustomerGuide(post({ published_at: '2024-01-01T00:00:00.000Z' }), now)).toBe(false);
    expect(isCurrentCustomerGuide(post({ seo_title: '2026년 8월 크루즈 예약 기준' }), now)).toBe(true);
  });

  it('prioritizes decision content and enforces the requested limit', () => {
    const selected = selectCurrentCustomerGuides([
      post({ id: 'generic', slug: 'generic', seo_title: '다낭 산책 코스', published_at: '2026-08-23T00:00:00.000Z' }),
      post({ id: 'decision', slug: 'decision', seo_title: '크루즈 예약 비용 비교', published_at: '2026-08-20T00:00:00.000Z' }),
    ], 1, now);
    expect(selected.map((item) => item.id)).toEqual(['decision']);
  });
});
