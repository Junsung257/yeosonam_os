import { describe, expect, it } from 'vitest';

import { evaluateCanonicalCompleteness } from './completeness';

describe('canonical completeness states', () => {
  it('turns missing supplier facts into pending_supplier instead of inventing values', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '상품가 별도 문의\n항공편 추후 확정\n호텔 미정',
      sectionIndex: 0,
      canonicalSection: {
        v3: {
          ledger: {
            variants: [{
              price_calendar: [],
              flight_segments: [{ leg: 'outbound', code: 'BX101', dep_time: null, arr_time: null }],
              days: [{ day: 1, events: [], hotel: {}, meals: {} }],
              inclusions: [],
              exclusions: [],
            }],
          },
        },
      },
    });

    expect(result.publicReady).toBe(false);
    expect(result.pendingSupplierCount).toBeGreaterThan(0);
    expect(result.fields.some(field => field.state === 'pending_supplier')).toBe(true);
  });

  it('marks ferry products as not_applicable for air-flight evidence', () => {
    const result = evaluateCanonicalCompleteness({
      rawText: '부산항 출발 페리 상품\n상품가 399,000원',
      sectionIndex: 0,
      canonicalSection: {
        v3: {
          ledger: {
            variants: [{
              price_calendar: [{ amount: 399000 }],
              flight_segments: [],
              days: [{ day: 1, events: [], hotel: { raw_text: '호텔' }, meals: {} }],
              inclusions: [{ value: '페리' }],
              exclusions: [{ value: '개인비용' }],
            }],
          },
        },
      },
    });

    expect(result.fields.find(field => field.fieldPath.endsWith('.flight'))?.state).toBe('not_applicable');
  });
});

