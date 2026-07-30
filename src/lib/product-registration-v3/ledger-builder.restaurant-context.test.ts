import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV3Ledger } from './ledger-builder';
import type { V3SourceLine, V3StructurePlan } from './types';

function sourceLines(quotes: string[]): V3SourceLine[] {
  let charStart = 0;
  return quotes.map((quote, index) => {
    const line = {
      lineNumber: index + 1,
      charStart,
      charEnd: charStart + quote.length,
      quote,
    };
    charStart += quote.length + 1;
    return line;
  });
}

function singleProductPlan(lineCount: number): V3StructurePlan {
  return {
    document_type: 'single_package',
    planner_source: 'deterministic',
    expected_products: 1,
    shared_sections: [],
    product_boundaries: [{
      index: 0,
      line_start: 1,
      line_end: lineCount,
      title_hint: '치앙마이 3박5일',
    }],
    variant_axes: [],
    price_table_location: null,
    price_mapping_strategy: 'none',
    flight_pattern: {
      outbound_codes: [],
      inbound_codes: [],
      meeting_times: [],
    },
    itinerary_boundary_pattern: 'day header lines',
    option_section_locations: [],
    shopping_section_locations: [],
    confidence: 1,
    unresolved_parts: [],
  };
}

describe('V3 ledger restaurant context classification', () => {
  it('keeps a standalone restaurant name next to a meal cell out of attractions', () => {
    const quotes = [
      '제1일',
      '석: 미슐랭추천',
      '미나미',
      '레스토랑',
      '호텔 투숙 및 휴식',
    ];
    const ledger = buildProductRegistrationV3Ledger(
      sourceLines(quotes),
      singleProductPlan(quotes.length),
    );
    const events = ledger.variants[0].days[0].events;

    expect(events.find(event => event.raw_text === '미나미')?.type).toBe('meal');
    expect(events.some(event => (
      event.raw_text === '미나미'
      && event.type === 'attraction'
    ))).toBe(false);
  });

  it('does not reclassify an attraction merely because a restaurant appears later', () => {
    const quotes = [
      '제1일',
      '왓록몰리 사원',
      '레스토랑',
      '호텔 투숙 및 휴식',
    ];
    const ledger = buildProductRegistrationV3Ledger(
      sourceLines(quotes),
      singleProductPlan(quotes.length),
    );

    expect(ledger.variants[0].days[0].events.find(
      event => event.raw_text === '왓록몰리 사원',
    )?.type).toBe('attraction');
  });
});
