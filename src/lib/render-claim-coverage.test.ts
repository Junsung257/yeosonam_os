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
});
