import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from '@/lib/product-registration-golden-fixtures';
import { recoverUploadPriceData } from './price-recovery';

const PHU_QUOC_PRICE_TEXT = `
[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일
스 팟 특 가
출 발 일
1인 상품가
7/1
959,000 원
6/24 & 7/8 & 9/2
969,000 원
출 발 요 일
수요일 / 목요일 출발
● 써챠지 7월1일 출발~ 8월30일출발 1인 5만원추가
6/7-6/30
9/1-9/22
1,199,000 원
7/1-7/24
10/9-10/24
1,249,000 원
일 자
제1일
부산
`;

describe('recoverUploadPriceData', () => {
  it('uses complete LLM tiers before falling through to deterministic recovery', async () => {
    const ed: ExtractedData = {
      title: 'LLM complete price product',
      destination: 'Clark',
      duration: 5,
      rawText: '',
      price_tiers: [{
        period_label: 'confirmed departure',
        departure_dates: ['2026-07-01'],
        adult_price: 777000,
        status: 'available',
      }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: 'This supplier raw text is intentionally long enough to allow deterministic parsing, but the complete LLM tier should be accepted first. Price 999,000.',
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('llm_hydrated');
    expect(result.priceRows).toHaveLength(1);
    expect(result.priceDates).toEqual([{ date: '2026-07-01', price: 777000, confirmed: false }]);
  });

  it('treats price success as product_prices plus price_dates, not price_tiers alone', async () => {
    const ed: ExtractedData = {
      title: '라벨-only 가격 상품',
      destination: '푸꾸옥',
      duration: 5,
      rawText: '',
      price_tiers: [{ period_label: '수요일 출발', departure_day_of_week: '수', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: '',
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(false);
    expect(result.priceRows).toHaveLength(0);
    expect(result.priceDates).toHaveLength(0);
    expect(result.failures).toContain('llm:price_dates 없음');
  });

  it('recovers malformed or label-only tiers through deterministic IR', async () => {
    const ed: ExtractedData = {
      title: '[부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일',
      destination: '푸꾸옥',
      duration: 5,
      accommodations: ['뉴월드푸꾸옥 - 가든풀빌라 2BED룸'],
      rawText: PHU_QUOC_PRICE_TEXT,
      price_tiers: [{ period_label: '출발일별 요금', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: PHU_QUOC_PRICE_TEXT,
      title: ed.title,
      accommodations: ed.accommodations,
      durationDays: ed.duration,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.length).toBeGreaterThan(0);
    expect(result.minPrice).toBe(969000);
    expect(result.priceDates.find(row => row.date === '2026-07-01')?.price).toBe(1009000);
  });

  it('recovers supplier raw free-text departure dates through the central pipeline', async () => {
    const fixture = SUPPLIER_RAW_GOLDEN_FIXTURES[0];
    const ed: ExtractedData = {
      title: fixture.expected.title,
      destination: fixture.expected.destination,
      duration: fixture.expected.dayCount,
      rawText: fixture.rawText,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: fixture.rawText,
      title: fixture.expected.title,
      durationDays: fixture.expected.dayCount,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('supplier_raw_facts');
    expect(result.minPrice).toBe(fixture.expected.adultPrice);
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.map(row => row.date)).toEqual(fixture.expected.departureDates);
    expect(result.priceDates.every(row => row.price === fixture.expected.adultPrice)).toBe(true);
  });
});
