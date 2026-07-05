import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from '@/lib/product-registration-golden-fixtures';
import {
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './golden-corpus/evaluator';
import { normalizeStrictFallbackPriceTiers, recoverUploadPriceData } from './price-recovery';

const mocks = vi.hoisted(() => ({
  llmCall: vi.fn(),
}));

vi.mock('@/lib/llm-gateway', () => ({
  llmCall: mocks.llmCall,
}));

function phuQuocCase() {
  const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'phu-quoc-full-upload');
  if (!testCase) throw new Error('missing phu-quoc-full-upload golden case');
  const rawText = readGoldenText(testCase.fixture);
  const expected = readGoldenExpected(testCase.expected);
  return { testCase, rawText, expected };
}

describe('recoverUploadPriceData', () => {
  beforeEach(() => {
    mocks.llmCall.mockReset();
  });

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

  it('keeps weekday and nullable child price fields after customer copy repair', async () => {
    const rawText = [
      '출발일 / 요일 / [세이브]',
      '7/23 목 529,000',
    ].join('\n');
    const ed: ExtractedData = {
      title: '[세이브] 다낭 / 호이안 / 바나산 실속 3박5일',
      destination: '다낭',
      duration: 5,
      rawText,
      price_tiers: [{
        period_label: '7/23 목',
        departure_dates: ['2026-07-23'],
        departure_day_of_week: '목',
        adult_price: 529000,
        status: 'available',
        note: 'source_catalog_grade_price_table',
      }],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: ed.title,
      durationDays: 5,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.priceRows).toEqual([
      expect.objectContaining({
        target_date: '2026-07-23',
        day_of_week: 'THU',
        net_price: 529000,
        child_price: null,
      }),
    ]);
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

  it('maps compact Macau/Hong Kong catalog price rows to the matching split product', async () => {
    const sharedPriceTable = [
      '선발특가 3/27까지 3.12 배포',
      '상 품 가',
      '출 발 일',
      '4/1~4/30 5/1~5/31 6/1~6/30',
      '비 고',
      '729,- 699,- 649,- 8명부터',
      '금',
      '마카오',
      '출발확정',
      '+1일자유',
      '2박4일 579,- 529,- 499,- 8명부터',
      '일',
      '출발확정',
      '799,- 779,- 739,- 8명부터',
      '금',
      '출발확정',
      '마카오/홍콩',
      '2박4일',
      '669,- 629,- 599,- 8명부터',
      '일',
      '출발확정',
      '마카오',
      '819,- 779,- 729,- 8명부터',
      '+2일자유 화',
      '출발확정',
      '3박5일',
      '마카오/홍콩',
      '949,- 899,- 859,- 8명부터',
      '화',
      '3박5일 출발확정',
      '마카오',
      '1,049,- 999,- 949,- 8명부터',
      '+홍콩+심천 화',
      '출발확정',
      '3박5일',
    ].join('\n');
    const cases = [
      ['PKG BX 마카오/1일자유 2박4일', 499000],
      ['PKG BX 마카오/홍콩 2박4일', 599000],
      ['PKG BX 마카오/2일자유 3박5일', 729000],
      ['PKG BX 마카오/홍콩 3박5일', 859000],
      ['PKG BX 마카오/홍콩+심천 3박5일', 949000],
    ] as const;

    for (const [title, minPrice] of cases) {
      const rawText = `${sharedPriceTable}\nPKG ${title}\n불포함사항 유류할증료변동분(3월-88,000기준)\n제1일 마카오 도착`;
      const result = await recoverUploadPriceData(
        { title, destination: '마카오', duration: title.includes('3박5일') ? 5 : 4, rawText } as ExtractedData,
        { rawText, year: 2026, enableGeminiFallback: false },
      );

      expect(result.ok).toBe(true);
      expect(result.source).toBe('supplier_compact_macau_hongkong_price_table');
      expect(result.minPrice).toBe(minPrice);
      expect(result.priceRows.some(row => row.net_price === 88000)).toBe(false);
    }
  });

  it('uses source-backed reader prices only when the date is tied to departure context', async () => {
    const rawText = [
      'PKG BX 청도 3색골프 3박4일',
      '2026.3.1',
      '549,000원',
      '출 발 일 26년 4/29(수) 판 매 가',
      '포함사항 왕복항공료 숙박료 식사 차량 여행자보험',
      '불포함사항 캐디피 카트피 선택관광 개인경비',
      '일정표 김해 국제공항 출발 청도 도착 골프 라운딩 호텔 휴식',
    ].join('\n');

    const result = await recoverUploadPriceData({
      rawText,
      title: 'PKG BX 청도 3색골프 3박4일',
      duration: 4,
      price_tiers: [],
    }, {
      rawText,
      title: 'PKG BX 청도 3색골프 3박4일',
      durationDays: 4,
      year: 2026,
      enableGeminiFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('human_reader_source_backed');
    expect(result.priceDates).toContainEqual(expect.objectContaining({
      date: '2026-04-29',
      price: 549000,
    }));
    expect(result.priceDates.some(row => row.date === '2026-03-01')).toBe(false);
  });

  it('drops option-sized amounts from weekday catalog price tables when package prices are present', async () => {
    const rawText = [
      '베트남 다낭/호이안 3박5일',
      '6월~10월 NO팁!! NO옵션!!',
      '스마트 VS 프리미엄',
      '항공스케줄',
      '부산-다낭 BX773 20:50 – 23:50 / 다낭-부산 BX774 00:45 – 07:20',
      '출발기간',
      '출발요일',
      'NO팁!! NO옵션!!',
      '스마트',
      '프리미엄',
      '8/30~9/12',
      '토/일',
      '729,000',
      '789,000',
      '월/화/수/목/금',
      '779,000',
      '839,000',
      '9/13~9/30',
      '토/일',
      '679,000',
      '739,000',
      '월/화/수/목/금',
      '729,000',
      '789,000',
      '불포함내역',
      '선택관광 발마사지30분 $30, 전신마사지60분 $50',
    ].join('\n');
    const ed: ExtractedData = {
      title: '베트남 다낭/호이안 3박5일',
      destination: '다낭',
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
    expect(result.source).toBe('deterministic:weekday_period_table');
    expect(result.minPrice).toBe(679000);
    expect(result.priceRows.some(row => row.net_price === 30000 || row.net_price === 50000)).toBe(false);
    expect(result.priceDates.some(row => row.price === 30000 || row.price === 50000)).toBe(false);
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

  it('uses the llm gateway DeepSeek fallback before direct Gemini price extraction', async () => {
    mocks.llmCall.mockResolvedValue({
      success: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      data: {
        price_tiers: [{
          period_label: 'DeepSeek recovered package price',
          departure_dates: ['2026-09-03'],
          adult_price: 777000,
          status: 'available',
        }],
      },
    });
    const rawText = `
신규 공급사 자유형 문서입니다.
이 문서는 의도적으로 deterministic 가격표 모양을 만들지 않습니다.
가격 정보는 AI fallback 검증용 mock 결과에서만 공급됩니다.
선택관광이나 팁 금액을 상품가로 오인하지 않는지 확인하기 위한 충분한 길이의 원문입니다.
반복 설명 텍스트를 추가하여 100자를 넘깁니다.
`;
    const ed: ExtractedData = {
      title: 'DeepSeek fallback price product',
      destination: '테스트',
      duration: 4,
      rawText,
      price_tiers: [],
    };

    const result = await recoverUploadPriceData(ed, {
      rawText,
      title: ed.title,
      durationDays: 4,
      year: 2026,
      enableGeminiFallback: true,
    });

    expect(mocks.llmCall).toHaveBeenCalledWith(expect.objectContaining({
      task: 'parse_travel_doc',
      autoEscalate: false,
    }));
    expect(result.ok).toBe(true);
    expect(result.source).toBe('ai_fallback:deepseek');
    expect(result.priceDates).toEqual([
      expect.objectContaining({ date: '2026-09-03', price: 777000 }),
    ]);
    expect(result.minPrice).toBe(777000);
  });
});
