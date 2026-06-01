import { describe, expect, it } from 'vitest';
import { parseV3AiStructurePlan, runProductRegistrationV3 } from '.';

const fixtures = [
  {
    name: 'baekdu multi variant style',
    raw: `
상품: Baekdu Table Standard 2N3D
가격 899,000원
최소출발 10명
DAY 1 Busan airport meeting 06:30
DAY 1 BX337 Busan depart 09:40 Yanji arrive 11:30
DAY 1 transfer to hotel
DAY 2 Heaven Lake attraction
DAY 2 lunch included
DAY 3 BX338 Yanji depart 12:30 Busan arrive 16:25
포함 왕복항공권
불포함 가이드팁
쇼핑센터 1회
`.trim(),
  },
  {
    name: 'optional tour block',
    raw: `
상품: Free Day Option Package
가격 719,000원
DAY 1 LJ115 depart 21:35 arrive 00:25
DAY 2 free time
선택관광 씨푸드 특식 $30
선택관광 전신 마사지 60분 $30
DAY 3 LJ116 depart 01:00 arrive 06:40
포함 호텔
불포함 개인경비
`.trim(),
  },
  {
    name: 'single package',
    raw: `
상품: Simple City 3D
가격 599,000원
최소 4명
DAY 1 KE123 depart 10:00 arrive 12:00
DAY 2 Museum visit
DAY 3 KE124 depart 13:00 arrive 15:00
포함 식사
불포함 매너팁
`.trim(),
  },
  {
    name: 'shopping package',
    raw: `
상품: Shopping Included 4D
가격 1,099,000원
DAY 1 OZ201 depart 08:10 arrive 10:30
DAY 2 Old town attraction
쇼핑 면세점 2회
DAY 4 OZ202 depart 20:10 arrive 23:00
포함 차량
불포함 옵션
`.trim(),
  },
  {
    name: 'hotel transfer meal decoy',
    raw: `
상품: Decoy Lines 5D
가격 1,299,000원
DAY 1 7C777 depart 09:00 arrive 11:20
DAY 1 airport transfer by private bus
DAY 1 호텔 체크인 및 휴식
DAY 2 조식 호텔식
DAY 2 Central Garden attraction
DAY 5 7C778 depart 14:00 arrive 17:00
포함 호텔 조식
불포함 싱글차지
`.trim(),
  },
];

describe('product-registration-v3 draft ledger pipeline', () => {
  it.each(fixtures)('builds a gated draft ledger for $name', async ({ raw }) => {
    const result = await runProductRegistrationV3(raw);

    expect(result.source_index.length).toBeGreaterThan(0);
    expect(result.structure_plan.expected_products).toBe(1);
    expect(result.ledger.variants).toHaveLength(1);
    expect(result.ledger.variants[0].price_calendar.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].flight_segments.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].days.length).toBeGreaterThan(0);
    expect(result.gate_result.status).not.toBe('blocked');
    expect(result.render_contract_preview).toHaveLength(1);
  });

  it('keeps airport meeting time as meeting, not flight departure', async () => {
    const result = await runProductRegistrationV3(fixtures[0].raw);
    const variant = result.ledger.variants[0];
    const meeting = variant.days.flatMap(day => day.events).find(event => event.type === 'meeting');

    expect(meeting?.time).toBe('06:30');
    expect(variant.flight_segments.map(segment => segment.dep_time)).not.toContain('06:30');
    expect(result.gate_result.checks.find(check => check.id.endsWith('meeting_not_flight'))?.status).toBe('pass');
  });

  it('uses line-level evidence and never whole raw text as fallback evidence', async () => {
    const result = await runProductRegistrationV3(fixtures[1].raw);
    const option = result.ledger.variants[0].options[0];

    expect(option.evidence.line_start).toBe(option.evidence.line_end);
    expect(option.evidence.quote).toContain('$30');
    expect(option.evidence.quote.length).toBeLessThan(fixtures[1].raw.length);
  });

  it('matches only existing attractions and queues the rest', async () => {
    const result = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [{ id: 'museum-1', name: 'Museum', region: 'City' }],
      destination: 'City',
    });
    expect(result.match_summary.attraction_matched_count).toBeGreaterThanOrEqual(1);
    expect(result.match_summary.attraction_unmatched_count).toBeGreaterThanOrEqual(0);
  });

  it('accepts only strict AI structure-plan schema, not extracted customer values', () => {
    const plan = parseV3AiStructurePlan({
      document_type: 'single_package',
      planner_source: 'deterministic',
      expected_products: 1,
      shared_sections: [],
      product_boundaries: [{ index: 0, line_start: 1, line_end: 3, title_hint: 'sample' }],
      variant_axes: [],
      price_table_location: null,
      price_mapping_strategy: 'unknown',
      flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
      itinerary_boundary_pattern: null,
      option_section_locations: [],
      shopping_section_locations: [],
      confidence: 0.5,
      unresolved_parts: [],
    });
    expect(plan.planner_source).toBe('ai_schema');

    expect(() => parseV3AiStructurePlan({
      document_type: 'single_package',
      planner_source: 'ai_schema',
      expected_products: 1,
      shared_sections: [],
      product_boundaries: [],
      variant_axes: [],
      price_table_location: null,
      price_mapping_strategy: 'unknown',
      flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
      itinerary_boundary_pattern: null,
      option_section_locations: [],
      shopping_section_locations: [],
      confidence: 0.5,
      unresolved_parts: [],
      final_price: 999000,
    })).toThrow();
  });
});
