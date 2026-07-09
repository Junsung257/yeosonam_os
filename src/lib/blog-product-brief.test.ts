import { describe, expect, it } from 'vitest';
import {
  buildProductBlogBrief,
  buildProductDedupKey,
  buildProductSeoKeyword,
  buildProductSlugSuffix,
  resolveProductDepartureDate,
  resolveProductPriceFrom,
} from './blog-product-brief';

describe('blog product brief', () => {
  const product = {
    id: 'pkg_123456789',
    title: '다낭 가족 패키지',
    destination: '다낭',
    duration: 5,
    price: 899000,
    land_operator: 'YSN',
    price_tiers: [
      { period_label: '7월', departure_dates: ['2026-07-11', '2026-07-18'], adult_price: 899000 },
    ],
    inclusions: ['항공', '호텔', '가이드'],
    excludes: ['개인경비'],
    itinerary: ['1일차', '2일차', '3일차'],
  };

  it('extracts departure facts for product slug and dedup keys', () => {
    expect(resolveProductDepartureDate(product)).toBe('2026-07-11');
    expect(buildProductDedupKey(product)).toBe('pkg_123456789|2026-07-11|5d|YSN');
    expect(buildProductSlugSuffix(product)).toContain('20260711');
    expect(buildProductSlugSuffix(product)).toContain('5d');
  });

  it('builds a product consultant brief with customer-readable decision facts', () => {
    const brief = buildProductBlogBrief(product, 'value');

    expect(brief).toMatchObject({
      content_type: 'package_intro',
      prompt_version: 'product-template-v4',
      product_id: 'pkg_123456789',
      primary_keyword: '다낭 5일 패키지',
      seo_keyword: '다낭 5일 패키지',
      departure_date: '2026-07-11',
      departure_city: null,
      duration: '4박5일',
      duration_days: 5,
      supplier_code: 'YSN',
      price_from: 899000,
      included: ['항공', '호텔', '가이드'],
      excluded: ['개인경비'],
    });
    expect(brief.fit_for).toContain('다낭 패키지를 가격, 일정, 포함 항목 기준으로 먼저 비교하고 싶은 분');
    expect(brief.not_fit_for).toContain('자유시간을 길게 두고 현지 일정을 직접 조합하고 싶은 분');
    expect(brief.risk_notes).toContain('가격은 출발일, 좌석, 유류할증료, 객실 조건에 따라 달라질 수 있습니다.');
    expect(brief.consult_questions).toContain('이 출발일에 현재 가능한 좌석과 객실이 있나요?');
  });

  it('uses source-backed price tables when the package price field is empty', () => {
    const priceTableProduct = {
      ...product,
      price: null,
      price_dates: [
        { date: '2026-07-11', price: 940000 },
        { date: '2026-07-18', price: 899000 },
      ],
      price_tiers: [{ adult_price: 990000 }],
    };
    const brief = buildProductBlogBrief(priceTableProduct, 'value');

    expect(resolveProductPriceFrom(priceTableProduct)).toBe(899000);
    expect(brief.price_from).toBe(899000);
  });

  it('builds a short product SEO keyword instead of using the full package title', () => {
    expect(buildProductSeoKeyword({
      id: 'pkg_long',
      destination: '몽골',
      duration: 6,
      title: 'PKG ZE 몽골 2인 골프 리조트 빈펄 4박6일 가성비 리뷰',
    })).toBe('몽골 6일 패키지');
  });
});
