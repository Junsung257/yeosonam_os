import { describe, expect, it } from 'vitest';
import { evaluateProductRegistrationV3Gate } from './gate';
import { createSourceLineIndex, planProductRegistrationV3 } from '.';
import type { V3DraftLedger, V3Evidence, V3EntityCategory, V3StructurePlan } from './types';

const evidence: V3Evidence = {
  line_start: 1,
  line_end: 1,
  char_start: 0,
  char_end: 10,
  quote: 'source',
};

function basePlan(requiresAir: boolean): V3StructurePlan {
  return {
    document_type: 'single_package',
    planner_source: 'deterministic',
    expected_products: 1,
    shared_sections: [],
    product_boundaries: [{ index: 0, line_start: 1, line_end: 4, title_hint: 'transport package' }],
    variant_axes: [],
    price_table_location: null,
    price_mapping_strategy: 'none',
    flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
    transport_profile: {
      requires_air: requiresAir,
      detected_modes: requiresAir ? ['air'] : ['ferry'],
      air_requirement_reason: requiresAir ? 'air_keyword_detected' : null,
    },
    itinerary_boundary_pattern: 'day header lines',
    option_section_locations: [],
    shopping_section_locations: [],
    confidence: 1,
    unresolved_parts: [],
  };
}

function baseLedger(flightSegments: V3DraftLedger['variants'][number]['flight_segments']): V3DraftLedger {
  return {
    document: { type: 'single_package', expected_products: 1, variant_axes: [] },
    variants: [{
      variant_key: 'v1',
      grade: null,
      course: 'transport package',
      duration_days: 3,
      nights: 2,
      title_parts: ['transport package'],
      price_calendar: [],
      flight_segments: flightSegments,
      days: [{
        day: 1,
        route: ['city tour'],
        events: [],
        meals: { breakfast: { raw_text: 'breakfast' }, lunch: {}, dinner: {} },
        hotel: { raw_text: 'hotel' },
      }],
      inclusions: [{ value: 'included', evidence }],
      exclusions: [{ value: 'excluded', evidence }],
      options: [],
      shopping: [],
      structured_facts: [],
      standard_notices: [],
      minimum_departure: { value: 2, evidence },
      evidence_coverage: {},
    }],
  };
}

describe('evaluateProductRegistrationV3Gate transport profile', () => {
  it('does not require air flight segments for ferry or non-air transport profiles', () => {
    const gate = evaluateProductRegistrationV3Gate(basePlan(false), baseLedger([]));

    expect(gate.checks.find(check => check.id === 'v1.flight')).toMatchObject({
      status: 'pass',
      message: 'air flight evidence is not required for this transport profile',
    });
  });

  it('keeps air package flight evidence as a critical gate', () => {
    const gate = evaluateProductRegistrationV3Gate(basePlan(true), baseLedger([]));

    expect(gate.checks.find(check => check.id === 'v1.flight')).toMatchObject({
      status: 'fail',
      severity: 'critical',
      message: 'air package has flight evidence',
    });
    expect(gate.status).toBe('blocked');
  });

  it('blocks contradictory guide-tip, no-option, and no-shopping customer facts', () => {
    const ledger = baseLedger([]);
    const variant = ledger.variants[0];
    const notice = (templateKey: string, category: string) => ({
      source_text: templateKey,
      category,
      template_key: templateKey,
      values: {},
      evidence: [evidence],
      visibility: 'customer_visible',
      risk_level: 'high',
      review_status: 'auto_clean',
      standard_text: templateKey,
    });
    variant.standard_notices = [
      notice('guide.tip_included', 'tip_guideline'),
      notice('guide.tip_amount_local_payment', 'tip_guideline'),
      notice('optional.none', 'optional_tour'),
      notice('shopping.none', 'shopping_visit'),
    ] as typeof variant.standard_notices;
    variant.options = [{ raw_name: '선택관광', normalized_name: '선택관광' }] as typeof variant.options;
    variant.shopping = [{ value: '쇼핑 1회', evidence }];

    const gate = evaluateProductRegistrationV3Gate(basePlan(false), ledger);

    expect(gate.checks.find(check => check.id.endsWith('guide_tip_not_contradictory'))?.status).toBe('fail');
    expect(gate.checks.find(check => check.id.endsWith('optional_tour_not_contradictory'))?.status).toBe('fail');
    expect(gate.checks.find(check => check.id.endsWith('shopping_not_contradictory'))?.status).toBe('fail');
    expect(gate.status).toBe('blocked');
  });

  it('allows explicitly priced extra options alongside a no-option package', () => {
    const ledger = baseLedger([]);
    const variant = ledger.variants[0];
    const notice = (templateKey: string, category: string) => ({
      source_text: templateKey,
      category,
      template_key: templateKey,
      values: {},
      evidence: [evidence],
      visibility: 'customer_visible',
      risk_level: 'high',
      review_status: 'auto_clean',
      standard_text: templateKey,
    });
    variant.standard_notices = [notice('optional.none', 'optional_tour')] as typeof variant.standard_notices;
    variant.options = [{
      raw_name: '추천 해양스포츠 $20',
      normalized_name: '해양스포츠',
      category: 'activity',
      price_amount: 20,
      currency: 'USD',
      region: null,
      city: null,
      duration_minutes: null,
      day_number: null,
      evidence,
      match_status: 'unmatched',
    }];

    const gate = evaluateProductRegistrationV3Gate(basePlan(false), ledger);

    expect(gate.checks.find(check => check.id.endsWith('optional_tour_not_contradictory'))?.status).toBe('pass');
  });

  it('accepts source-backed meal and hotel inclusions as V3 gate evidence', () => {
    const ledger = baseLedger([]);
    const variant = ledger.variants[0];
    variant.days = [{
      day: 1,
      route: ['tour'],
      events: [],
      meals: { breakfast: {}, lunch: {}, dinner: {} },
      hotel: {},
    }];
    variant.inclusions = [
      { value: '\ud638\ud154(2\uc7781\uc2e4)', evidence },
      { value: '\uc77c\uc815\ud45c\uc0c1\uc758 \uc2dd\uc0ac', evidence },
    ];

    const gate = evaluateProductRegistrationV3Gate(basePlan(false), ledger);

    expect(gate.checks.find(check => check.id === 'v1.meals_or_notice')).toMatchObject({ status: 'pass' });
    expect(gate.checks.find(check => check.id === 'v1.hotel_or_notice')).toMatchObject({ status: 'pass' });
  });

  it('keeps an unmatched attraction as an enrichment warning, not a publication blocker', () => {
    const ledger = baseLedger([]);
    ledger.variants[0].inclusions = [{ value: '왕복항공권', evidence }];
    ledger.variants[0].exclusions = [{ value: '개인경비', evidence }];
    const gate = evaluateProductRegistrationV3Gate(basePlan(false), ledger, {
      attraction_matched_count: 0,
      attraction_unmatched_count: 2,
      option_review_count: 0,
      shopping_count: 0,
      unmatched: [],
      entity_summary: {
        counts: {} as Record<V3EntityCategory, number>,
        review_required_count: 0,
        attraction_unresolved_count: 2,
        shopping_review_needed_count: 0,
        option_review_needed_count: 0,
        unknown_customer_visible_count: 0,
        auto_ignored_noise_count: 0,
        meal_structured_count: 0,
        transfer_structured_count: 0,
        hotel_structured_count: 0,
        free_time_structured_count: 0,
        review_items: [],
      },
    });

    expect(gate.checks.find(check => check.id === 'attraction_unmatched_queue_clear')).toMatchObject({
      status: 'warn',
      severity: 'info',
    });
    expect(gate.checks.find(check => check.id === 'entity_attraction_unresolved_clear')).toMatchObject({
      status: 'warn',
      severity: 'info',
    });
    expect(gate.status).toBe('ready_to_publish');
  });

  it('does not treat numeric price table values as flight codes', () => {
    const raw = [
      '\uBD80\uAD00\uD6FC\uB9AC \uD6C4\uCFE0\uC624\uCE74 3\uC77C',
      '2026-07-12 292,190\uC6D0',
      '2026-07-13 302,390\uC6D0',
      '1\uC77C\uCC28 \uBD80\uC0B0\uD56D \uCD9C\uD56D',
      '2\uC77C\uCC28 \uD558\uCE74\uB2E4\uD56D \uB3C4\uCC29',
    ].join('\n');

    const plan = planProductRegistrationV3(createSourceLineIndex(raw));

    expect(plan.flight_pattern).toEqual({
      outbound_codes: [],
      inbound_codes: [],
      meeting_times: [],
    });
    expect(plan.transport_profile).toMatchObject({
      requires_air: false,
      detected_modes: expect.arrayContaining(['ferry']),
    });
  });
});
