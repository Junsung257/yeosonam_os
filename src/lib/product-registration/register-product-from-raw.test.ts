import { describe, expect, it } from 'vitest';
import type { ExtractedData } from '@/lib/parser';
import {
  GOLDEN_CORPUS_CASES,
  readGoldenExpected,
  readGoldenText,
} from './golden-corpus/evaluator';
import { registerProductFromRaw } from './register-product-from-raw';

function phuQuocInput(): {
  rawText: string;
  expected: ReturnType<typeof readGoldenExpected>;
  extractedData: ExtractedData;
  duration: number;
  accommodations: string[];
} {
  const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'phu-quoc-full-upload');
  if (!testCase) throw new Error('missing phu-quoc-full-upload golden case');
  const rawText = readGoldenText(testCase.fixture);
  const expected = readGoldenExpected(testCase.expected);
  return {
    rawText,
    expected,
    duration: testCase.duration,
    accommodations: [...testCase.accommodations],
    extractedData: {
      title: expected.title,
      destination: expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [],
    },
  };
}

describe('registerProductFromRaw', () => {
  it('repairs a bad one-day duration from a clean sequential itinerary', async () => {
    const rawText = [
      '청도 3일 일정표',
      '3/8 399,000원',
      '제1일 신호산 관광',
      '제2일 청양 야시장 관광',
      '제3일 부산 도착',
    ].join('\n');

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: '청도 특가',
        destination: '청도',
        duration: 1,
        rawText,
        price_tiers: [],
      },
      itineraryData: {
        days: [
          { day: 1, schedule: [{ type: 'activity', activity: '신호산 관광' }] },
          { day: 2, schedule: [{ type: 'activity', activity: '청양 야시장 관광' }] },
          { day: 3, schedule: [{ type: 'flight', activity: '부산 도착' }] },
        ],
      } as never,
      title: '청도 특가',
      activeAttractions: [],
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.identity.durationDays).toBe(3);
    expect(result.extractedData.duration).toBe(3);
  });

  it('registers the Phu Quoc golden upload as customer deliverable', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.publishable).toBe(true);
    expect(result.deliverability.ok).toBe(true);
    expect(result.identity.destinationCode).toBe(expected.destinationCode);
    expect(result.pricing.source).toBe('deterministic:weekday_period_table');
    expect(result.pricing.minPrice).toBe(expected.minPrice);
    expect(result.pricing.priceDates.find(row => row.date === expected.specificDate)?.price).toBe(expected.specificDatePrice);
    expect(result.pricing.productPrices.every(row => row.adult_selling_price === row.net_price)).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('keeps Phu Quoc catalog column fragments out of schedule activities', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    const activities = result.itinerary.itineraryDataToSave?.days
      ?.flatMap(day => day.schedule?.map(item => item.activity).filter((activity): activity is string => typeof activity === 'string') ?? [])
      ?? [];

    expect(result.deliverability.ok).toBe(true);
    expect(activities).not.toEqual(expect.arrayContaining(['ZE981', '18:55', '22:25']));
    expect(result.itinerary.removedPollutedScheduleItems.length).toBeGreaterThan(0);
  });

  it('emits internal source evidence spans without requiring a DB migration', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.evidence.rawTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.spans.length).toBeGreaterThan(0);
    expect(result.evidence.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'title',
        rawTextHash: result.evidence.rawTextHash,
        productIndex: null,
        sourceKind: 'line',
      }),
    ]));
  });

  it('keeps external gate failures inside the same standard deliverability decision', async () => {
    const { rawText, expected, extractedData } = phuQuocInput();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData,
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-5D`,
      extraFailures: ['Product Registration V2 gate failed: fixture-block'],
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.publishable).toBe(false);
    expect(result.deliverability.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('fixture-block');
  });

  it('prunes customer copy highlights that are not backed by the uploaded source', async () => {
    const rawText = [
      '베트남 나트랑/달랏 3박5일',
      '부산-나트랑 BX781 19:20 - 22:20 / 나트랑-부산 BX782 23:20 - 06:20+1',
      '출발일 2026-08-30',
      '상품가 719,000',
      'DAY 1 부산/나트랑',
      '부산 출발',
      '나트랑 도착',
      'DAY 5 나트랑/부산',
      '나트랑 출발',
      '부산 도착',
      '포함 항공 호텔 식사 차량',
      '불포함 개인경비',
    ].join('\n');

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: '베트남 나트랑/달랏 3박5일',
        destination: '나트랑',
        duration: 5,
        rawText,
        price_tiers: [],
        product_highlights: ['백두산 북파 일정', '프리미엄'],
        product_summary: '백두산 북파 일정 중심 상품입니다.',
      },
      title: '베트남 나트랑/달랏 3박5일',
      activeAttractions: [],
      destinationCode: 'CXR',
      internalCode: 'PUS-ETC-CXR-05-TEST',
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.extractedData.product_highlights ?? []).not.toContain('백두산 북파 일정');
    expect(result.extractedData.product_summary ?? '').not.toContain('백두산');
  });

  it('blocks registration when source-backed round-trip flight times are missing from the customer itinerary payload', async () => {
    const rawText = [
      'Product: Baekdu flight regression 3N4D',
      'Price: 1,429,000 KRW / minimum 4',
      'DAY 1',
      'BX337',
      '06:30 airport meeting',
      '09:40 Gimhae departure',
      '11:30 Yanji arrival and guide meeting',
      'DAY 4',
      'BX338',
      '12:30 Yanji departure',
      '16:25 Gimhae arrival',
      'Include airfare hotel meal',
      'Exclude personal expenses',
    ].join('\n');

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: 'Baekdu flight regression 3N4D',
        destination: 'Yanji',
        duration: 4,
        rawText,
        price_tiers: [],
      },
      itineraryData: {
        days: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }],
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX337', dep_time: null, arr_time: null },
          { leg: 'inbound', flight_no: 'BX338', dep_time: null, arr_time: null },
        ],
      },
      title: 'Baekdu flight regression 3N4D',
      activeAttractions: [],
      destinationCode: 'YNJ',
      internalCode: 'PUS-ETC-YNJ-04-TEST',
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.publishable).toBe(false);
    expect(result.deliverability.ok).toBe(false);
    expect(result.deliverability.blockers.join('\n')).toContain('flight time source mismatch');
  });

  it('recovers shared document price tables when the product section has no local price table', async () => {
    const testCase = GOLDEN_CORPUS_CASES.find(item => item.id === 'fukuoka-golf-spot-weekday-cash-receipt');
    if (!testCase) throw new Error('missing fukuoka fixture');
    const documentRawText = readGoldenText(testCase.fixture);
    const expected = readGoldenExpected(testCase.expected);
    const sectionRawText = `
BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일
요금표참조
일자
1일차
후쿠오카 국제공항 도착
2일차
골프 18홀
3일차
후쿠오카 국제공항 출발
`;

    const result = await registerProductFromRaw({
      rawText: sectionRawText,
      documentRawText,
      extractedData: {
        title: expected.title,
        destination: expected.destination,
        duration: testCase.duration,
        rawText: sectionRawText,
        price_tiers: [],
      },
      itineraryData: {
        days: [{ day: 1 }, { day: 2 }, { day: 3 }],
      },
      title: expected.title,
      activeAttractions: [],
      destinationCode: expected.destinationCode,
      internalCode: `PUS-AA-${expected.destinationCode}-03-0001`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    expect(result.pricing.source).toBe('document_raw:deterministic:spot_weekday_table');
    expect(result.evidence.humanReader?.priceSource).toBe('spot_weekday_table');
    expect(result.evidence.humanReader?.pricePairCount).toBeGreaterThan(0);
    expect(result.evidence.priceAudit?.status).toBe('pass');
    expect(result.pricing.productPrices.length).toBeGreaterThan(0);
    expect(result.pricing.priceDates.length).toBeGreaterThan(0);
    expect(result.publishable).toBe(true);
  });

  it('recovers Crown Kyushu price and itinerary into customer landing-ready schedule data', async () => {
    const rawText = `
[크라운] 큐슈 BX조석 스기노이 2박 3일
상품가
7/1, 6, 8, 13, 15
1,299,000원
7/20, 22, 27, 29
1,399,000원
포함 내역
왕복항공권, 호텔, 일정표상 식사
불포함
개인경비
1일
부산
후쿠오카
BX142
09:00
10:00
김해 국제공항 출발
후쿠오카 국제공항 도착
전용차량
벳부 이동
▶ 유황재배지 유노하나 관광
▶ 가마도 지옥순례 및 족욕체험
*특전: 라무네(일본사이다)+계란 인당 1개 제공
호텔 이동 후 석식 및 휴식, ♨온천욕
조: 없음
중: 현지식
석: 호텔식
HOTEL: 스기노이 호텔 (니지관)
2일
유후인
전용차량
유후인 이동
▶ 긴린 호수 및 민예거리 관광
쿠로가와 이동
▶ 쿠로가와 온천마을 산책
벳부 이동
조: 호텔식
중: 현지식
석: 호텔식
HOTEL: 스기노이 호텔 (니지관)
3일
벳부
후쿠오카
전용차량
호텔 조식 후 체크아웃
면세점 쇼핑 후 후쿠오카 타워(내부관광) 관광
후쿠오카 국제공항 출발
김해 국제공항 도착
조: 호텔식
중: 없음
석: 없음
`;

    const result = await registerProductFromRaw({
      rawText,
      extractedData: {
        title: '크라운 · 후쿠오카 · 2박 3일 · BX142',
        destination: '큐슈 조석 스기노이',
        duration: 3,
        rawText,
        price_tiers: [],
      },
      itineraryData: null,
      title: '크라운 · 후쿠오카 · 2박 3일 · BX142',
      activeAttractions: [
        { id: 'yunohana', name: '유노하나 재배지', short_desc: '온천 침전물을 채취하는 명소' },
        { id: 'kamado', name: '가마도지옥', aliases: ['가마도 지옥순례'], short_desc: '벳부 지옥온천' },
        { id: 'kinrin', name: '긴린코호수', aliases: ['긴린 호수'], short_desc: '유후인의 호수' },
        { id: 'mingei', name: '유후인 민예거리', aliases: ['민예거리'], short_desc: '상점 거리' },
        { id: 'kurokawa', name: '쿠로가와 온천마을', short_desc: '온천 마을' },
        { id: 'fukuoka-tower', name: '후쿠오카 타워', short_desc: '후쿠오카 전망 명소' },
      ],
      destinationCode: 'FUK',
      internalCode: 'PUS-AA-FUK-03-0001',
      enableGeminiFallback: false,
      priceYear: 2026,
    });

    const savedDays = result.itinerary.itineraryDataToSave?.days ?? [];
    const labels = savedDays.flatMap(day => day.schedule ?? []).map(item => item.landing_sentence ?? item.activity);

    expect(result.pricing.source).toBe('deterministic:product_price_vertical_date_table');
    expect(result.pricing.priceDates.find(row => row.date === '2026-07-01')?.price).toBe(1299000);
    expect(result.deliverability.ok).toBe(true);
    expect(result.publishable).toBe(true);
    expect(savedDays).toHaveLength(3);
    expect(labels).toContain('쿠로가와 온천마을을 산책하며 온천 마을의 분위기를 둘러봅니다.');
    expect(labels).toContain('호텔로 이동해 석식 후 휴식하며 온천욕을 즐깁니다.');
  });
});
