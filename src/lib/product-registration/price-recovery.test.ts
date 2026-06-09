import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from '@/lib/product-registration-golden-fixtures';
import {
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './golden-corpus/evaluator';
import { normalizeStrictFallbackPriceTiers, recoverUploadPriceData } from './price-recovery';

function phuQuocCase() {
  const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'phu-quoc-full-upload');
  if (!testCase) throw new Error('missing phu-quoc-full-upload golden case');
  const rawText = readGoldenText(testCase.fixture);
  const expected = readGoldenExpected(testCase.expected);
  return { testCase, rawText, expected };
}

describe('recoverUploadPriceData', () => {
  it('accepts only schema-valid LLM fallback price tiers with usable date evidence', () => {
    const tiers = normalizeStrictFallbackPriceTiers([
      { period_label: 'valid date', departure_dates: ['2026-07-24'], adult_price: 859000, status: 'available' },
      { period_label: 'missing date', adult_price: 859000, status: 'available' },
      { period_label: 'bad date', departure_dates: ['07/24'], adult_price: 859000, status: 'available' },
      { period_label: 'string price', departure_dates: ['2026-07-25'], adult_price: '859,000', status: 'available' },
      { period_label: 'too small', departure_dates: ['2026-07-26'], adult_price: 5000, status: 'available' },
    ]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.departure_dates).toEqual(['2026-07-24']);
    expect(tiers[0]?.adult_price).toBe(859000);
  });

  it('prefers complete deterministic IR over complete LLM tiers', async () => {
    const { testCase, rawText, expected } = phuQuocCase();
    const ed: ExtractedData = {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [{
        period_label: 'llm complete',
        departure_dates: [expected.specificDate],
        adult_price: 777000,
        status: 'available',
      }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: expected.title,
      accommodations: testCase.accommodations,
      durationDays: testCase.duration,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.priceRows.length).toBeGreaterThan(1);
    expect(result.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
  });

  it('treats price success as product_prices plus price_dates, not price_tiers alone', async () => {
    const ed: ExtractedData = {
      title: 'label only price product',
      destination: 'Phu Quoc',
      duration: 5,
      rawText: '',
      price_tiers: [{ period_label: 'Wednesday departures', departure_day_of_week: 'Wed', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText: '',
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(false);
    expect(result.priceRows).toHaveLength(0);
    expect(result.priceDates).toHaveLength(0);
    expect(result.failures.some(failure => failure.startsWith('llm:price_dates'))).toBe(true);
  });

  it('recovers malformed or label-only tiers through deterministic IR', async () => {
    const { testCase, rawText, expected } = phuQuocCase();
    const ed: ExtractedData = {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [{ period_label: 'label only', adult_price: 959000, status: 'available' }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: expected.title,
      accommodations: testCase.accommodations,
      durationDays: testCase.duration,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.length).toBeGreaterThanOrEqual(expected.priceDatesMinCount);
    expect(result.minPrice).toBe(expected.minPrice);
    expect(result.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
    for (const forbiddenPrice of expected.forbiddenPrices) {
      expect(result.priceRows.some(row => row.net_price === forbiddenPrice)).toBe(false);
      expect(result.priceDates.some(row => row.price === forbiddenPrice)).toBe(false);
    }
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
    expect(result.source).toBe('deterministic:labeled_date_list_price');
    expect(result.minPrice).toBe(fixture.expected.adultPrice);
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.map(row => row.date)).toEqual(fixture.expected.departureDates);
    expect(result.priceDates.every(row => row.price === fixture.expected.adultPrice)).toBe(true);
  });

  it('recovers a day-table upload with a single travel period and product price line', async () => {
    const rawText = `
품격
♡TW항공 부산출발♡ 나트랑/달랏 3박5일
여행기간 2026년 5월 4일 ~ 5월 8일 까지 ★노팁+노옵션★
상품가 ₩399,000원/인 (*성인/아동 동일)
포함 사항
왕복 항공료, TAX, 유류할증료(2월기준), 호텔(2인1실), 식사, 전용차량
불포함 사항
유류할증료 변동분, 매너팁, 싱글룸 사용 시 1인 전일정 15만원 추가됩니다.
날짜|지역|교통편|시간|여행 일정|식사
제1일|부산|TW 041|21:10|부산 김해 국제공항 출발|기내식 불포함
|나트랑|전용차량|00:10+1|나트랑 깜란 국제공항 도착 후 입국 수속 및 가이드 미팅
`;
    const ed: ExtractedData = {
      title: '나트랑/달랏 3박5일',
      destination: '나트랑/달랏',
      duration: 5,
      rawText,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: ed.title,
      durationDays: 5,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:single_period_product_price');
    expect(result.minPrice).toBe(399000);
    expect(result.priceRows).toEqual([
      expect.objectContaining({
        target_date: '2026-05-04',
        net_price: 399000,
      }),
    ]);
    expect(result.priceDates).toEqual([
      expect.objectContaining({
        date: '2026-05-04',
        price: 399000,
      }),
    ]);
    expect(result.priceRows.some(row => row.net_price === 150000)).toBe(false);
  });

  it('recovers Baekdu shared grade-pattern price matrix without Gemini fallback', async () => {
    const rawText = `
★연길/백두산 7-8월 목/일 출발 증편★
2명부터 출발확정 목3박4일 / 일4박5일
출발일
패턴
세이브
스탠다드
프리미엄
크라운
7월
목요일
3박4일
7월2일 (목)
859,000
1,129,000
1,299,000
1,429,000
7월9일 (목)
7월16일 (목)
1,099,000
1,359,000
1,529,000
1,649,000
7월23일 (목)
859,000
1,129,000
1,299,000
1,429,000
7월30일 (목)
7월
일요일
4박5일
7월5일 (일)
799,000
1,149,000
1,339,000
1,429,000
7월12일 (일)
7월19일 (일)
7월26일 (일)
8월
목요일
3박4일
8월6일 (목)
859,000
1,129,000
1,299,000
1,429,000
8월13일 (목)
979,000
1,259,000
1,429,000
1,539,000
8월20일 (목)
859,000
1,129,000
1,299,000
1,429,000
8월
일요일
4박5일
8월2일 (일)
799,000
1,149,000
1,339,000
1,429,000
8월9일 (일)
8월16일 (일)
---
프리미엄노노노
연길/백두산(북+서파) 3박4일
`;
    const ed: ExtractedData = {
      title: '연길/백두산(북+서파) 3박4일',
      destination: '연길/백두산',
      duration: 4,
      rawText,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: ed.title,
      durationDays: 4,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('deterministic:grade_pattern_date_matrix');
    expect(result.priceRows.length).toBeGreaterThan(0);
    expect(result.priceDates.find(row => row.date === '2026-07-02')?.price).toBe(1299000);
    expect(result.priceDates.find(row => row.date === '2026-07-16')?.price).toBe(1529000);
    expect(result.priceDates.find(row => row.date === '2026-07-05')).toBeUndefined();
    expect(result.minPrice).toBe(1299000);
  });
});
