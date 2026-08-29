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

  it('does not call bare amounts a publishable departure-price calendar', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '\uC0C1\uD488\uAC00 549,000\uC6D0',
      sectionIndex: 0,
      canonicalSection: section({
        price_calendar: [{ date: null, label: '549,000', amount: 549000, currency: 'KRW' }],
      }),
    });

    expect(result.publicationOutcome).toBe('blocked');
    expect(result.blockers.some(reason => reason.includes('\uC801\uC6A9 \uBC94\uC704'))).toBe(true);
  });

  it('blocks an itinerary whose DAY count contradicts the product duration', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '발리 4박6일 상품',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 6,
        days: Array.from({ length: 5 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '발리 솔리아 또는 동급' },
          meals: {},
        })),
      }),
    });

    expect(result.publicationOutcome).toBe('blocked');
    expect(result.blockers.some(reason => reason.includes('6일') && reason.includes('5일'))).toBe(true);
  });

  it('accepts one arrival-only day omitted from DAY headings when overnight travel is explicit', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '발리 4박6일 상품, 심야 출발 후 익일 도착, 귀국편 기내박',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 6,
        days: Array.from({ length: 5 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '발리 솔리아 또는 동급' },
          meals: {},
        })),
      }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.itinerary'))?.state).toBe('confirmed');
    expect(result.blockers.some(reason => reason.includes('DAY 일정'))).toBe(false);
  });

  it('accepts an omitted arrival-only DAY when source-backed flight times cross midnight', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '푸꾸옥 3박5일 에어텔 VJ968 23:10 출발 06:40 도착',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 5,
        nights: 3,
        flight_segments: [{ leg: 'inbound', code: 'VJ968', dep_time: '23:10', arr_time: '06:40' }],
        days: Array.from({ length: 4 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '푸꾸옥 리조트' },
          meals: {},
        })),
      }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.itinerary'))?.state).toBe('confirmed');
  });

  it('accepts supplier flight notation with a +1 arrival marker as overnight evidence', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '나트랑 3박5일 BX781 19:20 – 22:20 / BX782 23:20 – 06:20+1',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 5,
        days: Array.from({ length: 4 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '나트랑 호텔 또는 동급' },
          meals: {},
        })),
      }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.itinerary'))?.state).toBe('confirmed');
    expect(result.blockers.some(reason => reason.includes('DAY 일정'))).toBe(false);
  });

  it('degrades an explicitly marked extra-night variant without inventing a missing day', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '장가계 4박5일 상품\n제3일 일정\n*4박5일',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 5,
        days: Array.from({ length: 4 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '장가계 호텔 또는 동급' },
          meals: {},
        })),
      }),
    });

    expect(result.publicationOutcome).toBe('degraded');
    expect(result.publicReady).toBe(true);
    expect(result.degradedReasons.some(reason => reason.includes('추가 숙박 표시'))).toBe(true);
  });

  it('does not excuse duplicate or missing DAY labels without explicit overnight evidence', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '내몽고 4박5일 상품, 제4일 표제가 두 번 기재됨',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 5,
        days: Array.from({ length: 4 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '우란호텔 또는 동급' },
          meals: {},
        })),
      }),
    });

    expect(result.publicationOutcome).toBe('blocked');
    expect(result.blockers.some(reason => reason.includes('5일') && reason.includes('4일'))).toBe(true);
  });

  it('degrades the common one-day departure/arrival omission when transport context is present', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '보홀 4박6일 BX321 출발·도착 일정표',
      sectionIndex: 0,
      canonicalSection: section({
        duration_days: 6,
        flight_segments: [{ leg: 'outbound', code: 'BX321', dep_time: '19:00', arr_time: '22:00' }],
        days: Array.from({ length: 5 }, (_, index) => ({
          day: index + 1,
          events: [],
          hotel: { raw_text: '보홀 리조트' },
          meals: {},
        })),
      }),
    });

    expect(result.publicationOutcome).toBe('degraded');
    expect(result.publicReady).toBe(true);
    expect(result.degradedReasons.some(reason => reason.includes('출발·도착일 일정'))).toBe(true);
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

  it('does not require a hotel for an explicitly no-overnight product', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '부관훼리 초특가 무박 3일 상품, 부산항 출발',
      sectionIndex: 0,
      canonicalSection: section({
        flight_segments: [],
        days: [{ day: 1, events: [], hotel: {}, meals: {} }],
      }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.lodging'))?.state).toBe('not_applicable');
    expect(result.publicationOutcome).toBe('verified');
  });

  it('recognizes hotel evidence recorded in inclusions when the itinerary has no hotel row', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '다낭 3박5일, 호텔 숙박 포함, 성인 399,000원',
      sectionIndex: 0,
      canonicalSection: section({
        days: [{ day: 1, events: [], hotel: {}, meals: {} }],
        inclusions: [{ value: '다낭 시내 4성급 호텔 숙박' }],
      }),
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.lodging'))?.state).toBe('confirmed');
    expect(result.blockers.some(reason => reason.includes('.lodging'))).toBe(false);
  });

  it('degrades absent inclusion or exclusion facts with a customer disclosure', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '다낭 3박 5일 BX321 19:00 출발, 성인 399,000원',
      sectionIndex: 0,
      canonicalSection: section({ inclusions: [], exclusions: [] }),
    });

    expect(result.publicationOutcome).toBe('degraded');
    expect(result.blockers.some(reason => reason.includes('.inclusions'))).toBe(false);
    expect(result.blockers.some(reason => reason.includes('.exclusions'))).toBe(false);
    expect(result.degradedReasons.some(reason => reason.includes('.inclusions'))).toBe(true);
    expect(result.degradedReasons.some(reason => reason.includes('.exclusions'))).toBe(true);
  });

  it('does not accept table headings as commercial facts', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '포 함 내 역\n불포함 내역',
      sectionIndex: 0,
      canonicalSection: section({
        inclusions: [{ value: '포 함 내 역' }],
        exclusions: [{ value: '불포함 내역' }],
      }),
    });

    expect(result.publicationOutcome).toBe('degraded');
    expect(result.blockers.some(reason => reason.includes('.inclusions'))).toBe(false);
    expect(result.blockers.some(reason => reason.includes('.exclusions'))).toBe(false);
  });
});
