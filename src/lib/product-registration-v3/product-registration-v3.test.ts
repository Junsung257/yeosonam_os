import { describe, expect, it } from 'vitest';
import { parseV3AiStructurePlan, persistProductRegistrationDraftV3, runProductRegistrationV3 } from '.';
import { buildStandardNoticeDraft } from './standard-notices';
import { mapTravelPackageToLandingData } from '../map-travel-package-to-lp';
import { renderPackage } from '../render-contract';

function buildBaekduEightVariantFixture(): string {
  const grades = ['Standard', 'Premium', 'Lilac', 'VIP'];
  const durations = ['2N3D', '3N4D'];
  return [
    '공통 안내: 포함 왕복항공권, 호텔, 식사 / 불포함 개인경비 / 최소출발 10명',
    ...grades.flatMap((grade, gradeIndex) =>
      durations.map((duration, durationIndex) => {
        const idx = gradeIndex * durations.length + durationIndex;
        const outbound = idx % 2 === 0 ? 'BX337' : 'KE337';
        const inbound = idx % 2 === 0 ? 'BX338' : 'KE338';
        const price = (899000 + idx * 50000).toLocaleString('ko-KR');
        return [
          `상품: Baekdu ${grade} ${duration}`,
          `가격 ${price}원 / 최소출발 10명`,
          'DAY 1 부산 공항 미팅 06:30',
          `DAY 1 ${outbound} 부산 출발 09:40 연길 도착 11:30`,
          'DAY 1 전용버스 이동 후 호텔 체크인',
          'DAY 2 백두산 천지 관광',
          'DAY 2 중식 포함',
          `DAY ${duration === '2N3D' ? 3 : 4} ${inbound} 연길 출발 12:30 부산 도착 16:25`,
          '포함 왕복항공권 호텔 식사',
          '불포함 가이드팁 개인경비',
        ].join('\n');
      }),
    ),
  ].join('\n');
}

const fixtures = [
  {
    name: 'optional tour block',
    raw: `
상품: Free Day Option Package
가격 719,000원 / 최소출발 4명
DAY 1 LJ115 부산 출발 21:35 도착 00:25
DAY 2 자유시간
선택관광 현지지불 특식 $30
선택관광 전신 마사지 60분 $30
DAY 3 LJ116 출발 01:00 도착 06:40
포함 호텔
불포함 개인경비
`.trim(),
  },
  {
    name: 'single package',
    raw: `
상품: Simple City 3D
가격 599,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
DAY 2 Museum visit
DAY 3 KE124 출발 13:00 도착 15:00
포함 식사
불포함 매너팁
`.trim(),
  },
  {
    name: 'shopping package',
    raw: `
상품: Shopping Included 4D
가격 1,099,000원 / 최소출발 6명
DAY 1 OZ201 출발 08:10 도착 10:30
DAY 2 Old town attraction
쇼핑 면세점 2회
DAY 4 OZ202 출발 20:10 도착 23:00
포함 차량
불포함 옵션
`.trim(),
  },
  {
    name: 'hotel transfer meal decoy',
    raw: `
상품: Decoy Lines 5D
가격 1,299,000원 / 최소출발 8명
DAY 1 7C777 출발 09:00 도착 11:20
DAY 1 airport transfer by private bus
DAY 1 호텔 체크인 및 휴식
DAY 2 조식 호텔식
DAY 2 Central Garden attraction
DAY 5 7C778 출발 14:00 도착 17:00
포함 호텔 조식
불포함 기타차지
`.trim(),
  },
  {
    name: 'nha-trang-dalat-remark-standardization',
    raw: `
상품: 나트랑 달랏 3박5일
가격 619,000원 / 최소출발 4명
DAY 1 LJ115 부산 출발 21:35 도착 00:25
DAY 2 포나가르 사원 관광
REMARK
싱글차지 전일정 기준 인당 18만 원 추가됩니다.
여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.
베트남 자국민 보호법으로 공항미팅/관광지 방문 불가하므로 설명은 차량에서 대체하며 현지 가이드와 동행합니다.
호텔 룸배정(일행과 같은 층, 옆방 배정, 베드 타입) 등은 개런티 불가합니다.
전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.
마사지 팁 기준(나트랑: 60분-$4, 90분-$5, 120분-$6 / 달랏: 60분-$4, 90분-$5, 120분-$7)입니다.
패키지 일정 미참여 시 패널티 1인/1박/$100 청구됩니다.
나트랑 식당들은 주차장 구비된 곳이 많지가 않고 차량 진입이 어려워 도보 이동이 있을 수 있습니다.
베트남 전자담배 반입 불가합니다.
DAY 5 LJ116 출발 01:00 도착 06:40
포함 호텔
불포함 개인경비
`.trim(),
  },
];

describe('product-registration-v3 draft ledger pipeline', () => {
  it.each(fixtures)('builds a gated draft ledger for $name', async ({ raw, name }) => {
    const result = await runProductRegistrationV3(raw);

    expect(result.source_index.length).toBeGreaterThan(0);
    expect(result.structure_plan.expected_products).toBe(1);
    expect(result.ledger.variants).toHaveLength(1);
    expect(result.ledger.variants[0].price_calendar.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].flight_segments.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].days.length).toBeGreaterThan(0);
    if (name !== 'nha-trang-dalat-remark-standardization') {
      expect(result.gate_result.status).not.toBe('blocked');
    }
    expect(result.render_contract_preview).toHaveLength(1);
  });

  it('splits a Baekdu catalog into 8 draft variants with per-variant evidence', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());

    expect(result.structure_plan.document_type).toBe('catalog');
    expect(result.structure_plan.expected_products).toBe(8);
    expect(result.ledger.variants).toHaveLength(8);
    expect(result.structure_plan.variant_axes.map(axis => axis.name)).toEqual(['grade', 'duration']);
    for (const variant of result.ledger.variants) {
      expect(variant.price_calendar).toHaveLength(1);
      expect(variant.flight_segments).toHaveLength(2);
      expect(variant.days.length).toBeGreaterThanOrEqual(3);
      expect(variant.minimum_departure?.value).toBe(10);
      expect(variant.evidence_coverage.price).toBe(true);
      expect(variant.evidence_coverage.flight).toBe(true);
    }
  });

  it('keeps airport meeting time as meeting, not flight departure', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());
    const variant = result.ledger.variants[0];
    const meeting = variant.days.flatMap(day => day.events).find(event => event.type === 'meeting');

    expect(meeting?.time).toBe('06:30');
    expect(variant.flight_segments.map(segment => segment.dep_time)).not.toContain('06:30');
    expect(result.gate_result.checks.find(check => check.id.endsWith('meeting_not_flight'))?.status).toBe('pass');
  });

  it('uses line-level evidence and never whole raw text as fallback evidence', async () => {
    const result = await runProductRegistrationV3(fixtures[0].raw);
    const option = result.ledger.variants[0].options[0];

    expect(option.evidence.line_start).toBe(option.evidence.line_end);
    expect(option.evidence.quote).toContain('$30');
    expect(option.evidence.quote.length).toBeLessThan(fixtures[0].raw.length);
    expect(option.duration_minutes).toBe(60);
  });

  it('matches only existing attractions and queues the rest for review', async () => {
    const result = await runProductRegistrationV3(fixtures[1].raw, {
      attractions: [{ id: 'museum-1', name: 'Museum', region: 'City' }],
      destination: 'City',
    });
    expect(result.match_summary.attraction_matched_count).toBeGreaterThanOrEqual(1);
    expect(result.match_summary.attraction_unmatched_count).toBe(0);

    const unmatched = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [],
      destination: 'City',
    });
    expect(unmatched.match_summary.unmatched.length).toBeGreaterThanOrEqual(1);
    expect(unmatched.gate_result.checks.find(check => check.id === 'attraction_unmatched_queue_clear')?.status).toBe('fail');
  });

  it('persists V3 draft and forwards unmatched attractions to the review queue', async () => {
    const result = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [],
      destination: 'City',
    });
    const rpcCalls: unknown[] = [];
    const fakeSupabase = {
      from(table: string) {
        if (table === 'product_registration_drafts') {
          return {
            insert() {
              return {
                select() {
                  return {
                    single: async () => ({ data: { id: 'draft-1' }, error: null }),
                  };
                },
              };
            },
          };
        }
        return {
          upsert: async () => ({ error: null }),
        };
      },
      rpc(name: string, payload: unknown) {
        rpcCalls.push({ name, payload });
        return {
          single: async () => ({ data: null, error: null }),
        };
      },
    };

    const persisted = await persistProductRegistrationDraftV3(fakeSupabase as never, {
      packageId: '00000000-0000-0000-0000-000000000001',
      packageTitle: 'Shopping Included 4D',
      destination: 'City',
      rawText: fixtures[2].raw,
      result,
    });

    expect(persisted.id).toBe('draft-1');
    expect(persisted.error).toBeNull();
    expect(persisted.queuedUnmatched).toBe(result.match_summary.unmatched.length);
    expect(rpcCalls).toHaveLength(result.match_summary.unmatched.length);
    expect(rpcCalls[0]).toMatchObject({ name: 'upsert_unmatched_activity' });
  });

  it('feeds the same V3 render contract into mobile LP and A4 canonical rendering', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());
    const renderInput = result.render_contract_preview[0];
    const canonicalView = renderPackage(renderInput);
    const landingData = mapTravelPackageToLandingData({
      id: 'v3-draft-preview',
      destination: '백두산',
      duration: renderInput.itinerary_data?.days?.length ?? 0,
      price_dates: renderInput.price_dates,
      inclusions: renderInput.inclusions,
      excludes: renderInput.excludes,
      itinerary_data: renderInput.itinerary_data,
      optional_tours: renderInput.optional_tours,
      title: renderInput.title,
      product_type: renderInput.product_type,
    }, null);

    expect(canonicalView.days.length).toBeGreaterThan(0);
    expect(landingData.itinerary.days).toHaveLength(canonicalView.days.length);
    expect(landingData.flightSummary?.outbound?.code).toBe('BX337');
    expect(landingData.flightSummary?.outbound?.depTime).toBe('09:40');
    expect(landingData.flightSummary?.outbound?.depTime).not.toBe('06:30');
    expect(landingData.itinerary.includes.length).toBeGreaterThan(0);
    expect(landingData.itinerary.excludes.length).toBeGreaterThan(0);
  });

  it('does not classify hotel, transfer, meal, shopping, or option lines as attractions', async () => {
    const result = await runProductRegistrationV3(fixtures[3].raw);
    const events = result.ledger.variants[0].days.flatMap(day => day.events);

    expect(events.some(event => event.type === 'hotel')).toBe(true);
    expect(events.some(event => event.type === 'transfer')).toBe(true);
    expect(events.some(event => event.type === 'meal')).toBe(true);
    expect(events.filter(event => event.type === 'attraction').map(event => event.raw_text)).toEqual(['Central Garden attraction']);
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

  it('extracts nha-trang/dalat REMARK into standard categories with template values', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const notices = result.ledger.variants[0].standard_notices;
    const categories = notices.map(n => n.category);
    expect(categories).toEqual(expect.arrayContaining([
      'single_room_surcharge',
      'passport_validity',
      'local_law_restriction',
      'room_assignment',
      'itinerary_change',
      'tip_guideline',
      'group_schedule_penalty',
      'restaurant_access',
      'local_guide_operation',
    ]));
    const single = notices.find(n => n.category === 'single_room_surcharge');
    const passport = notices.find(n => n.category === 'passport_validity');
    const localLaw = notices.find(n => n.category === 'local_law_restriction');
    const penalty = notices.find(n => n.category === 'group_schedule_penalty');
    expect(single?.values.amount).toBe(180000);
    expect(single?.standard_text).toContain('18만 원');
    expect(passport?.values.months).toBe(6);
    expect(localLaw?.values.item).toBeTruthy();
    expect(penalty?.values.amount).toBe(100);
    expect(notices.every(n => n.standard_text && n.standard_text !== n.source_text)).toBe(true);
    expect(notices.every(n => n.evidence.length > 0 && n.evidence[0].quote === n.source_text)).toBe(true);
  });

  it('renders customer notices with Yeosonam standard text only (no supplier remark leakage)', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const preview = result.render_contract_preview[0];
    const customerNotes = String(preview.customer_notes ?? '');
    expect(customerNotes).toContain('여권 만료일은 입국일 기준 6개월 이상 남아 있어야 합니다.');
    expect(customerNotes).not.toContain('전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.');
    expect(customerNotes).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
    expect(JSON.stringify(preview.notices_parsed ?? [])).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
  });

  it('does not leak supplier remark raw text into mobile LP/A4 render surfaces', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const preview = result.render_contract_preview[0];
    const canonicalView = renderPackage(preview);
    const landingData = mapTravelPackageToLandingData({
      id: 'nha-v3',
      destination: '나트랑/달랏',
      duration: preview.itinerary_data?.days?.length ?? 0,
      price_dates: preview.price_dates,
      inclusions: preview.inclusions,
      excludes: preview.excludes,
      itinerary_data: preview.itinerary_data,
      optional_tours: preview.optional_tours,
      title: preview.title,
      product_type: preview.product_type,
    }, null);
    const blob = JSON.stringify({ canonicalView, landingData, customerNotes: preview.customer_notes, notices: preview.notices_parsed });
    expect(blob).not.toContain('전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.');
    expect(blob).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
  });

  it('blocks publish when high-risk notice value is missing', async () => {
    const raw = `
상품: 하이리스크 검증
가격 499,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
REMARK
싱글차지 발생합니다.
DAY 3 KE124 출발 13:00 도착 15:00
`.trim();
    const result = await runProductRegistrationV3(raw);
    expect(result.gate_result.status).toBe('blocked');
    expect(result.gate_result.checks.some(c => c.id.endsWith('high_risk_notice_values') && c.status === 'fail')).toBe(true);
  });

  it('extracts prohibited e-cigarette notice even when supplier omits country name', async () => {
    const raw = `
상품: 전자담배 고위험 검증
가격 499,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
REMARK
전자담배 반입금지입니다.
DAY 3 KE124 출발 13:00 도착 15:00
`.trim();
    const result = await runProductRegistrationV3(raw);
    const notice = result.ledger.variants[0].standard_notices.find(n => n.category === 'local_law_restriction');
    expect(notice?.values.item).toBe('전자담배');
    expect(notice?.values.country).toBeNull();
    expect(notice?.review_status).toBe('review_needed');
    expect(notice?.standard_text).toBe('현지에서는 전자담배 반입이 금지되어 있습니다.');
    expect(notice?.source_text).toBe('전자담배 반입금지입니다.');
    expect(result.gate_result.status).toBe('blocked');
    expect(result.gate_result.checks.some(c => c.id.endsWith('high_risk_notice_values') && c.status === 'fail')).toBe(true);
  });

  it('marks customer-visible high-risk notices review_needed when evidence is missing', () => {
    const notice = buildStandardNoticeDraft({
      source_text: '싱글차지 전 일정 기준 인당 18만 원 추가됩니다.',
      category: 'single_room_surcharge',
      values: { amount: 180000, currency: '원' },
      evidence: [],
    });

    expect(notice?.risk_level).toBe('high');
    expect(notice?.visibility).toBe('customer_visible');
    expect(notice?.review_status).toBe('review_needed');
  });
});
