import { describe, expect, it } from 'vitest';

import type { V3DraftLedger } from './types';
import { ledgerToRenderPackageInputs } from './render-contract-adapter';

describe('V3 ledger render adapter', () => {
  it('renders typed daily meals without duplicating derived meal-policy notices', () => {
    const evidence = { line_start: 1, line_end: 1, char_start: 0, char_end: 5, quote: 'fixture' };
    const ledger: V3DraftLedger = {
      document: { type: 'single_package', expected_products: 1, variant_axes: [] },
      variants: [{
        variant_key: 'v1', grade: null, course: null, duration_days: 1, nights: 0,
        title_parts: ['마쓰야마 골프 1일'], price_calendar: [], flight_segments: [],
        days: [{
          day: 1, route: ['마쓰야마'], events: [], hotel: {},
          meals: { breakfast: { raw_text: '조:호텔식' }, lunch: {}, dinner: {} },
        }],
        inclusions: [], exclusions: [], options: [], shopping: [], structured_facts: [],
        standard_notices: [{
          source_text: '조:호텔식', category: 'meal_plan', template_key: 'meal.summary',
          values: { summary: '조식 호텔식' }, evidence: [evidence], visibility: 'customer_visible',
          risk_level: 'low', review_status: 'auto_clean', standard_text: '일정표 기준 식사는 조식 호텔식으로 제공됩니다.',
        }],
        minimum_departure: null,
        evidence_coverage: {},
      }],
    };

    const [rendered] = ledgerToRenderPackageInputs(ledger);
    expect(rendered?.itinerary_data?.days?.[0]?.meals?.breakfast).toBe(true);
    expect(rendered?.customer_notes).toBe('');
    expect(rendered?.notices_parsed).toEqual([]);
  });

  it('keeps explicitly excluded daily meals disabled while preserving the source note', () => {
    const ledger: V3DraftLedger = {
      document: { type: 'single_package', expected_products: 1, variant_axes: [] },
      variants: [{
        variant_key: 'v1', grade: null, course: null, duration_days: 1, nights: 0,
        title_parts: ['마쓰야마 골프 1일'], price_calendar: [], flight_segments: [],
        days: [{
          day: 1, route: [], events: [], hotel: {},
          meals: {
            breakfast: { raw_text: '조:호텔식' },
            lunch: { raw_text: '중:불포함' },
            dinner: { raw_text: '석:미제공' },
          },
        }],
        inclusions: [], exclusions: [], options: [], shopping: [], structured_facts: [],
        standard_notices: [], minimum_departure: null, evidence_coverage: {},
      }],
    };

    const meals = ledgerToRenderPackageInputs(ledger)[0]?.itinerary_data?.days?.[0]?.meals;
    expect(meals).toMatchObject({
      breakfast: true,
      breakfast_note: '조:호텔식',
      lunch: false,
      lunch_note: '중:불포함',
      dinner: false,
      dinner_note: '석:미제공',
    });
  });
});
