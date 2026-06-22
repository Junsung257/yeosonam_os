import { describe, expect, it } from 'vitest';
import { evaluateRenderClaimCoverage, extractRenderClaims } from './render-claim-coverage';

describe('render-claim-coverage', () => {
  const pkg = {
    airline: 'LJ',
    departure_airport: '부산',
    destination: '나트랑',
    inclusions: ['왕복항공권'],
    excludes: ['개인경비'],
    itinerary_data: {
      meta: { flight_out: 'LJ115', flight_in: 'LJ116', departure_airport: '부산' },
      days: [
        {
          day: 1,
          regions: ['부산', '나트랑'],
          schedule: [
            { type: 'flight', activity: '부산 국제공항 출발', time: '10:00', transport: 'LJ115' },
            { type: 'flight', activity: '나트랑 국제공항 도착', time: '13:00', transport: 'LJ115' },
            { type: 'normal', activity: '호텔 체크인 및 휴식' },
          ],
          hotel: { name: '멜리아 빈펄', grade: '5성' },
        },
        {
          day: 2,
          regions: ['나트랑'],
          schedule: [{ type: 'normal', activity: '포나가르 사원 관광' }],
          hotel: { name: '멜리아 빈펄', grade: '5성' },
        },
      ],
    },
  };

  it('extracts customer-visible render claims from CanonicalView', () => {
    const claims = extractRenderClaims(pkg);
    expect(claims.some(c => c.value === 'LJ115')).toBe(true);
    expect(claims.some(c => c.value === '멜리아 빈펄')).toBe(true);
    expect(claims.some(c => c.value === '포나가르 사원 관광')).toBe(true);
  });

  it('reports unsupported rendered claims', () => {
    const result = evaluateRenderClaimCoverage({
      ...pkg,
      raw_text: 'LJ115 LJ116 10:00 13:00 왕복항공권 개인경비 포나가르 사원 관광',
    });
    expect(result.unsupported.some(c => c.value === '멜리아 빈펄')).toBe(true);
  });

  it('extracts price date and amount claims from price_dates', () => {
    const claims = extractRenderClaims({
      price_dates: [{ date: '2027-02-04', price: 619000, confirmed: true }],
      itinerary_data: { days: [] },
    });
    expect(claims.some(c => c.id === 'priceDates[0].date' && c.value === '2027-02-04')).toBe(true);
    expect(claims.some(c => c.id === 'priceDates[0].price' && c.value === '619000')).toBe(true);
  });

  it('accepts price_dates when raw has display-form date and comma price', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '출발일 2/4 요금 619,000원',
      price_dates: [{ date: '2027-02-04', price: 619000, confirmed: true }],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.id === 'priceDates[0].date')).toBe(false);
    expect(result.unsupported.some(c => c.id === 'priceDates[0].price')).toBe(false);
  });

  it('accepts Korean month/day raw date labels for ISO price dates', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '출발일 7월8일 (수) 상품가 749,000원',
      price_dates: [{ date: '2026-07-08', price: 749000, confirmed: true }],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(c => c.id === 'priceDates[0].date')).toBe(false);
    expect(result.unsupported.some(c => c.id === 'priceDates[0].price')).toBe(false);
  });

  it('accepts compact supplier date lists such as 7/1, 8, 15, 22', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '7/1, 8, 15, 22\n749,000원',
      price_dates: [{ date: '2026-07-08', price: 749000, confirmed: true }],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(c => c.id === 'priceDates[0].date')).toBe(false);
    expect(result.unsupported.some(c => c.id === 'priceDates[0].price')).toBe(false);
  });

  it('accepts reordered term tokens such as 기타 개인경비 for 개인경비 · 기타', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '불포함: 유류할증료, 기타 개인경비',
      excludes: ['개인경비 · 기타'],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(c => c.value === '개인경비 · 기타')).toBe(false);
  });

  it('accepts sourceEvidence support even when raw text exact match is absent', () => {
    const result = evaluateRenderClaimCoverage({
      ...pkg,
      raw_text: 'LJ115 LJ116 10:00 13:00 왕복항공권 개인경비 포나가르 사원 관광',
    }, {
      hotel: [{ rawTextHash: 'h', start: 0, end: 5, quote: '멜리아 빈펄', confidence: 1, source: 'manual' }],
    });
    expect(result.unsupported.some(c => c.value === '멜리아 빈펄')).toBe(false);
  });

  it('accepts deterministic merged flight labels when source rows exist', () => {
    const result = evaluateRenderClaimCoverage({
      airline: 'LJ',
      raw_text: 'LJ115 부산 출발\n나트랑 도착 00:25',
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              { type: 'flight', activity: 'LJ115 부산 출발', time: '21:35', transport: 'LJ115' },
              { type: 'flight', activity: '나트랑 도착', time: '00:25', transport: 'LJ115' },
            ],
          },
        ],
      },
    });

    expect(result.unsupported.some(c => c.value === '부산 출발 → 나트랑 도착 00:25')).toBe(false);
  });

  it('still rejects placeholder merged flight labels', () => {
    const result = evaluateRenderClaimCoverage({
      airline: 'LJ',
      raw_text: 'LJ115 부산 출발\n나트랑 도착 00:25',
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [{ type: 'flight', activity: '출발지 출발 → 도착지 도착 00:25', time: '21:35', transport: 'LJ115' }],
          },
        ],
      },
    });

    expect(result.unsupported.some(c => c.value === '출발지 출발 → 도착지 도착 00:25')).toBe(true);
  });

  it('accepts display punctuation inserted by term normalization', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '개인경비 및 매너팁',
      excludes: ['개인경비 및 매너팁'],
      itinerary_data: { days: [] },
    });

    expect(result.unsupported.some(c => c.value.includes('개인경비'))).toBe(false);
  });

  it('treats "개인경비 · 불포함" as supported when raw has "개인경비"', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '불포함: 개인경비',
      excludes: ['개인경비'],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.value === '개인경비 · 불포함')).toBe(false);
  });

  it('accepts optional tour display name with region suffix stripped', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '선택관광: 전신 마사지',
      optional_tours: [{ name: '전신 마사지', region: '베트남' }],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.value === '전신 마사지')).toBe(false);
  });

  it('accepts optional tour price token USD4 when raw has $4', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '마사지 팁 $4',
      optional_tours: [{ name: '마사지 팁', price: 'USD4', region: '베트남' }],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.value === 'USD4')).toBe(false);
  });

  it('accepts date-like price token 2027-02-04 when raw has 2월 4일', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '특전가 적용일 2월 4일',
      optional_tours: [{ name: '스페셜 옵션', price: '2027-02-04', region: '베트남' }],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.value === '2027-02-04')).toBe(false);
  });

  it('accepts date-like price token 2027-02-11 when raw has 2/11', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '추가요금 적용: 2/11',
      optional_tours: [{ name: '스페셜 옵션', price: '2027-02-11', region: '베트남' }],
      itinerary_data: { days: [] },
    });
    expect(result.unsupported.some(c => c.value === '2027-02-11')).toBe(false);
  });

  it('accepts hotel grade token 5성 when raw has 5성급', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '호텔: 멜리아 빈펄 (5성급)',
      itinerary_data: {
        days: [
          {
            day: 1,
            hotel: { name: '멜리아 빈펄', grade: '5성' },
            schedule: [{ type: 'normal', activity: '호텔 체크인 및 휴식' }],
          },
        ],
      },
    });
    expect(result.unsupported.some(c => c.value === '5성')).toBe(false);
  });

  it('accepts hotel grade token 준5성 when raw has 준 5성급', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '호텔 등급: 준 5성급',
      itinerary_data: {
        days: [
          {
            day: 1,
            hotel: { name: '시그니처 호텔', grade: '준5성' },
            schedule: [{ type: 'normal', activity: '호텔 체크인 및 휴식' }],
          },
        ],
      },
    });
    expect(result.unsupported.some(c => c.value === '준5성')).toBe(false);
  });

  it('accepts flight city token 부산(김해) when raw has 부산 김해', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '출발: 부산 김해 / 도착: 나트랑',
      itinerary_data: {
        flight_segments: [
          {
            leg: 'outbound',
            flight_no: 'LJ115',
            dep_airport: '부산(김해)',
            dep_time: '21:35',
            arr_airport: '나트랑',
            arr_time: '00:25',
            arr_day_offset: 0,
          },
        ],
        days: [],
      },
    });
    expect(result.unsupported.some(c => c.value === '부산(김해)')).toBe(false);
  });

  it('accepts flight city token 김해국제공항 when raw has 김해', () => {
    const result = evaluateRenderClaimCoverage({
      raw_text: '김해 출발 / 인천 도착',
      itinerary_data: {
        flight_segments: [
          {
            leg: 'outbound',
            flight_no: 'KE123',
            dep_airport: '김해국제공항',
            dep_time: '10:00',
            arr_airport: '인천국제공항',
            arr_time: '11:10',
            arr_day_offset: 0,
          },
        ],
        days: [],
      },
    });
    expect(result.unsupported.some(c => c.value === '김해국제공항')).toBe(false);
    expect(result.unsupported.some(c => c.value === '인천국제공항')).toBe(false);
  });
});
