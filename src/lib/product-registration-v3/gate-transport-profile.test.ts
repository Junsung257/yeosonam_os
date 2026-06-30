import { describe, expect, it } from 'vitest';
import { evaluateProductRegistrationV3Gate } from './gate';
import { createSourceLineIndex, planProductRegistrationV3 } from '.';
import type { V3DraftLedger, V3Evidence, V3StructurePlan } from './types';

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
