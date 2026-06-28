import { describe, expect, it } from 'vitest';
import {
  buildProductBlogBrief,
  buildProductDedupKey,
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
      prompt_version: 'product-template-v2',
      product_id: 'pkg_123456789',
      primary_keyword: '다낭 다낭 가족 패키지',
      departure_date: '2026-07-11',
      departure_city: null,
      duration: '4박 5일',
      duration_days: 5,
      supplier_code: 'YSN',
      price_from: 899000,
      included: ['항공', '호텔', '가이드'],
      excluded: ['개인경비'],
    });
    expect(brief.fit_for).toContain('다낭 패키지를 가격과 일정 기준으로 먼저 비교하려는 고객');
    expect(brief.not_fit_for).toContain('자유일정 비중이 큰 개별여행을 원하는 고객');
    expect(brief.risk_notes).toContain('가격과 좌석은 발권/예약 시점에 따라 달라질 수 있음');
    expect(brief.consult_questions).toContain('인원과 출발 가능일은 어떻게 되나요?');
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
});
