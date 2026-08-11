import { describe, expect, it } from 'vitest';

import { evaluateCanonicalCompleteness } from './completeness';

function section(overrides: Record<string, unknown> = {}) {
  return {
    v3: {
      ledger: {
        variants: [{
          price_calendar: [{ date: '2026-10-01', amount: 399000, currency: 'KRW' }],
          flight_segments: [{ leg: 'outbound', code: 'BX321', dep_time: '19:00', arr_time: '22:00' }],
          days: [{ day: 1, events: [], hotel: { raw_text: '다낭 시내 4성급 동급 호텔' }, meals: {} }],
          inclusions: [{ value: '왕복 항공' }],
          exclusions: [{ value: '개인 경비' }],
          ...overrides,
        }],
      },
    },
  };
}

describe('canonical completeness states', () => {
  it('marks a complete source-backed section verified', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '다낭 3박 5일 BX321 19:00 출발, 성인 399,000원',
      sectionIndex: 0,
      canonicalSection: section(),
    });

    expect(result.publicationOutcome).toBe('verified');
    expect(result.publicReady).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('allows an explicitly unconfirmed flight time as safe degraded output', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '항공편 시간은 추후 확정, 호텔은 동급 예정',
      sectionIndex: 0,
      canonicalSection: section({
        flight_segments: [{ leg: 'outbound', code: 'BX321', dep_time: null, arr_time: null }],
        days: [{ day: 1, events: [], hotel: {}, meals: {} }],
      }),
    });

    expect(result.publicationOutcome).toBe('degraded');
    expect(result.publicReady).toBe(true);
    expect(result.degradedReasons.some(reason => reason.includes('flight_times'))).toBe(true);
    expect(result.degradedReasons.some(reason => reason.includes('lodging'))).toBe(true);
  });

  it('never degrades a missing price even when the supplier asks for inquiry', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '상품가는 별도 문의, 항공편은 추후 확정, 호텔 미정',
      sectionIndex: 0,
      canonicalSection: section({
        price_calendar: [],
        flight_segments: [{ leg: 'outbound', code: 'BX321', dep_time: null, arr_time: null }],
        days: [{ day: 1, events: [], hotel: {}, meals: {} }],
      }),
    });

    expect(result.publicationOutcome).toBe('blocked');
    expect(result.publicReady).toBe(false);
    expect(result.blockers.some(reason => reason.includes('.price'))).toBe(true);
  });

  it('marks ferry products as not applicable for air-flight evidence', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '부산항 출발 훼리 상품, 상품가 399,000원',
      sectionIndex: 0,
      canonicalSection: section({ flight_segments: [] }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.flight'))?.state).toBe('not_applicable');
    expect(result.publicationOutcome).toBe('verified');
  });

  it('blocks absent inclusion or exclusion facts', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '다낭 3박 5일 BX321 19:00 출발, 성인 399,000원',
      sectionIndex: 0,
      canonicalSection: section({ inclusions: [], exclusions: [] }),
    });

    expect(result.publicationOutcome).toBe('blocked');
    expect(result.blockers.some(reason => reason.includes('.inclusions'))).toBe(true);
    expect(result.blockers.some(reason => reason.includes('.exclusions'))).toBe(true);
  });
});
