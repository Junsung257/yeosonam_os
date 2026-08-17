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

  it('projects an expired source ticketing condition into consultation-only customer data', () => {
    const ledger: V3DraftLedger = {
      document: { type: 'single_package', expected_products: 1, variant_axes: [] },
      variants: [{
        variant_key: 'v1', grade: null, course: null, duration_days: 5, nights: 3,
        title_parts: ['다낭 3박5일'], price_calendar: [], flight_segments: [], days: [],
        inclusions: [], exclusions: [], options: [], shopping: [], structured_facts: [],
        standard_notices: [], minimum_departure: null, evidence_coverage: {},
        ticketing_condition: {
          kind: 'fixed_deadline',
          status: 'expired',
          deadline: '2026-08-14',
          relativeDays: null,
          customerNotice: '발권기한 경과 · 현재 좌석과 요금 상담 확인',
          consultationOnly: true,
          marketingEligible: false,
          sourceText: '8/14까지 발권조건',
          conditionHash: 'a'.repeat(64),
          evidence: {
            line_start: 1,
            line_end: 1,
            char_start: 0,
            char_end: 12,
            quote: '8/14까지 발권조건',
            extraction_method: 'text_line',
          },
        },
      }],
    };

    const [rendered] = ledgerToRenderPackageInputs(ledger);
    expect(rendered).toMatchObject({
      ticketing_deadline: '2026-08-14',
      ticketing_deadline_status: 'expired',
      booking_mode: 'consultation_only',
      marketing_eligible: false,
    });
    expect(rendered?.customer_notes).toContain('현재 좌석과 요금 상담 확인');
    expect(rendered?.notices_parsed).toContainEqual(expect.objectContaining({
      type: 'SOURCE_TICKETING_CONDITION',
    }));
  });

  it('does not label a dated price as departure-confirmed without explicit source proof', () => {
    const evidence = { line_start: 1, line_end: 1, char_start: 0, char_end: 8, quote: '699,000원' };
    const baseVariant: V3DraftLedger['variants'][number] = {
      variant_key: 'v1', grade: null, course: null, duration_days: 5, nights: 3,
      title_parts: ['푸꾸옥 3박5일'], flight_segments: [], days: [],
      inclusions: [], exclusions: [], options: [], shopping: [], structured_facts: [],
      standard_notices: [], minimum_departure: null, evidence_coverage: {},
      price_calendar: [
        { date: '2026-09-10', label: '출발일', amount: 799000, currency: 'KRW', evidence },
        { date: '2026-09-18', label: '출발확정', amount: 699000, currency: 'KRW', evidence, departure_confirmed: true },
      ],
    };
    const [rendered] = ledgerToRenderPackageInputs({
      document: { type: 'single_package', expected_products: 1, variant_axes: [] },
      variants: [baseVariant],
    });
    expect(rendered?.price_dates).toEqual([
      expect.objectContaining({ date: '2026-09-10', confirmed: false }),
      expect.objectContaining({ date: '2026-09-18', confirmed: true }),
    ]);
  });
});
