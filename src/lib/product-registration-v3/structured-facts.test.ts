import { describe, expect, it } from 'vitest';
import { createSourceLineIndex } from './source-line-index';
import { extractStructuredFactsFromSupplierText } from './structured-facts';
import { runProductRegistrationV3 } from '.';

describe('product-registration-v3 structured facts', () => {
  it('extracts guide tip amount and renders a standard customer notice', () => {
    const rawText = '가이드 & 기사 팁 $50/P(성인/아동 동일 현지 직불)';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(fact?.values).toMatchObject({ included: false, amount: 50, currency: 'USD', payment: 'local' });
    expect(fact?.review_status).toBe('auto_clean');
    expect(fact?.standard_text).toBe('가이드/기사 팁은 1인 기준 $50 현지 지불입니다.');
    expect(result.standardNotices[0]?.standard_text).toBe('가이드/기사 팁은 1인 기준 $50 현지 지불입니다.');
  });

  it('extracts trailing-dollar guide tip amount as source-backed auto-clean evidence', () => {
    const rawText = '가이드/기사경비 50$ ,개인 비용, 매너팁';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');
    const notice = result.standardNotices.find(row => row.category === 'tip_guideline');

    expect(fact?.values).toMatchObject({ included: false, amount: 50, currency: 'USD', payment: 'local' });
    expect(fact?.review_status).toBe('auto_clean');
    expect(notice?.values).toMatchObject({ amount: 50, currency: 'USD' });
    expect(notice?.review_status).toBe('auto_clean');
  });

  it('treats no-tip and included guide tip as an explicit safe state', () => {
    const rawText = '포함사항: 기사/가이드팁 포함, 노팁 상품';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(fact?.values).toMatchObject({ included: true, amount: null });
    expect(fact?.review_status).toBe('auto_clean');
    expect(result.customerFieldPatch.guide_tip).toBe('포함');
    expect(result.standardNotices[0]?.standard_text).toBe('가이드/기사 팁은 포함되어 있습니다.');
  });

  it('keeps included guide tip evidence authoritative over amount-less derived tip noise', () => {
    const rawText = [
      '포함사항: 기사/가이드팁 포함, 노팁 상품',
      '가이드/기사경비, 개인 비용, 매너팁',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');
    const reviewNeededNotices = result.standardNotices.filter(row =>
      row.category === 'tip_guideline' && row.review_status === 'review_needed'
    );

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
    expect(guideTips[0]?.review_status).toBe('auto_clean');
    expect(reviewNeededNotices).toHaveLength(0);
  });

  it('keeps explicit amount-less local guide tip conflicts blocked even when included evidence exists', () => {
    const rawText = [
      '포함사항: 기사/가이드팁 포함, 노팁 상품',
      '불포함: 가이드/기사 팁 별도',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });

    expect(result.structuredFacts.some(row =>
      row.category === 'guide_tip' && row.review_status === 'review_needed'
    )).toBe(true);
  });

  it('extracts Korean adult minimum departure and included guide tip from catalog terms', () => {
    const rawText = [
      '성인 6명 이상 / 인솔자 미동행',
      '왕복항공료, 유류할증료, TAX, 호텔(2인1실), 식사, 전용차량, 관광지 입장료, 여행자보험, 기사&가이드팁,',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const minPax = result.structuredFacts.find(row => row.category === 'min_pax');
    const guideTip = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(minPax?.values).toMatchObject({ count: 6 });
    expect(guideTip?.values).toMatchObject({ included: true, amount: null });
    expect(guideTip?.review_status).toBe('auto_clean');
  });

  it('does not misread first-come capacity as a minimum departure promise', () => {
    const rawText = '모객인원 각항차별 30명 선착순마감';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });

    expect(result.structuredFacts.some(row => row.category === 'min_pax')).toBe(false);
    expect(result.standardNotices.some(row => row.category === 'minimum_departure')).toBe(false);
  });

  it('treats guide expense inside an inclusion list as included instead of missing local payment', () => {
    const rawText = '기사가이드경비, 바나산 국립공원 입장료, 전신마사지 2시간, 김해공항샌딩, 해외여행자보험';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const guideTip = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(guideTip?.values).toMatchObject({ included: true, amount: null });
    expect(guideTip?.review_status).toBe('auto_clean');
    expect(result.standardNotices.some(row =>
      row.category === 'tip_guideline' && row.review_status === 'review_needed'
    )).toBe(false);
  });

  it('does not apply a massage tip exclusion to an included guide tip on the same line', () => {
    const rawText = '항공료, 숙박, 입장료, 전용차량, 기사/가이드팁, 전신마사지 90분(팁별도)';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
    expect(guideTips[0]?.review_status).toBe('auto_clean');
  });

  it('extracts no option, no shopping, shopping count, hotel grade, meals, and transport', () => {
    const rawText = [
      '침향&노니, 커피 [쇼핑2회] / 노옵션',
      '쇼핑 0회 노쇼핑',
      'HOTEL : 무엉탄 럭셔리 또는 동급 [4성급]',
      '조: 호텔식 / 중: 현지식 / 석: 한식',
      '전용차량&기사, 페리, 케이블카, 도보 이동',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const categories = result.structuredFacts.map(row => row.category);

    expect(categories).toEqual(expect.arrayContaining([
      'shopping_policy',
      'optional_tour',
      'hotel_grade',
      'meal_plan',
      'transport',
    ]));
    expect(result.structuredFacts.find(row => row.category === 'optional_tour')?.values).toMatchObject({ none: true });
    expect(result.structuredFacts.find(row => row.category === 'hotel_grade')?.values.grade).toBe('4성급');
    expect(result.customerFieldPatch.itinerary_highlights?.shopping).toMatch(/쇼핑/);
  });

  it('uses inquiry wording for missing single room surcharge amount instead of raw supplier text', () => {
    const rawText = '싱글차지 별도 문의';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'room_policy');
    const notice = result.standardNotices.find(row => row.category === 'single_room_surcharge');

    expect(fact?.values.inquiry).toBe(true);
    expect(fact?.review_status).toBe('review_needed');
    expect(fact?.standard_text).toBe('1인실 사용 시 추가 요금은 예약 시 확인이 필요합니다.');
    expect(notice?.standard_text).toBe('1인실 사용 시 추가 요금은 예약 시 확인이 필요합니다.');
    expect(notice?.source_text).toBe(rawText);
    expect(notice?.standard_text).not.toBe(rawText);
  });

  it('extracts source-backed USD single room surcharge as an auto-clean notice', () => {
    const rawText = '\uAC1C\uC778\uACBD\uBE44 \uBC0F \uB9E4\uB108\uD301, \uC2F1\uAE00\uCC28\uC9C0 $110/\uC778/\uC804\uC77C\uC815';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'room_policy');
    const notice = result.standardNotices.find(row => row.category === 'single_room_surcharge');

    expect(fact?.values).toMatchObject({ single_supplement_amount: 110, currency: 'USD', inquiry: false });
    expect(fact?.review_status).toBe('auto_clean');
    expect(notice?.template_key).toBe('single_room_surcharge.full_trip');
    expect(notice?.values).toMatchObject({ amount: 110, currency: 'USD' });
    expect(notice?.review_status).toBe('auto_clean');
  });

  it('promotes structured Korean adult minimum departure into the V3 ledger gate', async () => {
    const rawText = [
      'Product: CAN structured gate sample',
      '\uAC00\uACA9 899,000\uC6D0',
      'DAY 1 BX123 \uCD9C\uBC1C 10:00 \uB3C4\uCC29 12:00',
      'DAY 2 \uAD11\uC800\uC6B0 \uAD00\uAD11',
      'DAY 3 \uCC9C\uC800\uC6B0 \uAD00\uAD11',
      'DAY 4 BX124 \uCD9C\uBC1C 22:00 \uB3C4\uCC29 01:00',
      '\uD3EC\uD568\uC0AC\uD56D: \uC655\uBCF5\uD56D\uACF5\uB8CC, \uC720\uB958\uD560\uC99D\uB8CC, \uD638\uD154(2\uC7781\uC2E4), \uC2DD\uC0AC, \uC804\uC6A9\uCC28\uB7C9, \uAD00\uAD11\uC9C0 \uC785\uC7A5\uB8CC, \uC5EC\uD589\uC790\uBCF4\uD5D8, \uAE30\uC0AC&\uAC00\uC774\uB4DC\uD301',
      '\uC131\uC778 6\uBA85 \uC774\uC0C1 / \uC778\uC194\uC790 \uBBF8\uB3D9\uD589',
      '\uBD88\uD3EC\uD568: \uAC1C\uC778\uACBD\uBE44 \uBC0F \uB9E4\uB108\uD301, \uC2F1\uAE00\uCC28\uC9C0 $110/\uC778/\uC804\uC77C\uC815',
    ].join('\n');
    const result = await runProductRegistrationV3(rawText);
    const variant = result.ledger.variants[0];

    expect(variant.minimum_departure?.value).toBe(6);
    expect(result.gate_result.checks.find(check => check.id.endsWith('minimum_departure'))?.status).toBe('pass');
    expect(result.gate_result.checks.find(check => check.id.endsWith('high_risk_notice_values'))?.status).toBe('pass');
  });

  it('recovers separated inbound arrival time before the arrival text line', async () => {
    const rawText = [
      'Product: separated inbound arrival 3N5D',
      '\uAC00\uACA9 779,000\uC6D0 / \uCD5C\uC18C\uCD9C\uBC1C 4\uBA85',
      'DAY 1',
      'BX781',
      '19:20',
      '22:20',
      '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uCD9C\uBC1C',
      '\uB098\uD2B8\uB791 \uAE5C\uB780 \uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29',
      'DAY 2 \uB098\uD2B8\uB791 \uAD00\uAD11',
      'DAY 3 \uB2EC\uB7CF \uAD00\uAD11',
      'DAY 4 \uB098\uD2B8\uB791 \uC790\uC720\uC2DC\uAC04',
      'DAY 5',
      'BX782',
      '23:20',
      '\uB098\uD2B8\uB791 \uAE5C\uB780 \uAD6D\uC81C \uACF5\uD56D \uCD9C\uBC1C',
      '06:20',
      '\uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29',
      '\uD3EC\uD568: \uD56D\uACF5\uB8CC, \uD638\uD154, \uC2DD\uC0AC',
      '\uBD88\uD3EC\uD568: \uAC1C\uC778\uACBD\uBE44',
    ].join('\n');
    const result = await runProductRegistrationV3(rawText);
    const inbound = result.ledger.variants[0].flight_segments.find(segment => segment.leg === 'inbound');

    expect(inbound?.dep_time).toBe('23:20');
    expect(inbound?.arr_time).toBe('06:20');
    expect(result.gate_result.checks.find(check => check.id.endsWith('flight_times_complete'))?.status).toBe('pass');
  });

  it('extracts source-backed golf shopping visit as a customer-safe disclosure', () => {
    const rawText = '* \uACE8\uD504 \uBA85\uD488\uC0F5 \uBC29\uBB38 \uD3EC\uD568\uC73C\uB85C \uD589\uC0AC \uC9C4\uD589\uB429\uB2C8\uB2E4.';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'shopping_policy');
    const notice = result.standardNotices.find(row => row.category === 'shopping_visit');

    expect(fact?.values).toMatchObject({ none: false, count: 1 });
    expect(fact?.review_status).toBe('auto_clean');
    expect(notice?.template_key).toBe('shopping.visits_count');
    expect(notice?.review_status).toBe('auto_clean');
  });

  it('extracts explicit package-shopping counts from shopping-category lists', () => {
    const rawText = [
      '쇼핑센터',
      '커피, 침향, 잡화 중 3회 방문',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'shopping_policy');
    const notice = result.standardNotices.find(row => row.category === 'shopping_visit');

    expect(fact?.values).toMatchObject({
      none: false,
      count: 3,
      items: expect.arrayContaining(['커피', '침향', '잡화']),
    });
    expect(fact?.review_status).toBe('auto_clean');
    expect(notice?.template_key).toBe('shopping.visits_count');
    expect(notice?.standard_text).toContain('쇼핑센터 3회 방문');
  });

  it('extracts explicit shopping-tour counts without treating them as free-time shopping', () => {
    const rawText = '여행의 또다른 즐거움 쇼핑관광 3회';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'shopping_policy');

    expect(fact?.values).toMatchObject({ none: false, count: 3 });
    expect(fact?.values).not.toHaveProperty('optional_self_directed', true);
    expect(fact?.review_status).toBe('auto_clean');
  });

  it('discloses free-time self-directed shopping without labeling it a required shopping visit', () => {
    const rawText = '깜란 자유시간 (마사지, 이발소, 커피숍, 멀티숍쇼핑, 마트 등 개별 자유시간)';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'shopping_policy');
    const notice = result.standardNotices.find(row => row.category === 'shopping_visit');

    expect(fact?.values).toMatchObject({
      none: false,
      count: 0,
      required: false,
      optional_self_directed: true,
    });
    expect(fact?.review_status).toBe('auto_clean');
    expect(notice?.template_key).toBe('shopping.optional_self_directed');
    expect(notice?.standard_text).toBe('자유시간 중 개별 쇼핑은 선택 사항이며, 필수 쇼핑 일정이 아닙니다.');
    expect(result.customerFieldPatch.itinerary_highlights?.shopping).not.toContain('쇼핑 방문 포함');
  });

  it('keeps Japanese-yen guide tips in yen in facts and customer notices', () => {
    const rawText = '가이드/기사 팁 1인 2만엔 현지 지불';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');
    const notice = result.standardNotices.find(row => row.category === 'tip_guideline');

    expect(fact?.values).toMatchObject({ included: false, amount: 20000, currency: 'JPY' });
    expect(fact?.standard_text).toContain('20,000엔');
    expect(notice?.values).toMatchObject({ amount: 20000, currency: 'JPY' });
    expect(notice?.standard_text).toContain('20,000엔');
    expect(notice?.standard_text).not.toContain('2만원');
  });

  it('treats season holiday extra-fee inquiry as an explicit safe inquiry state', () => {
    const rawText = '* \uC911\uAD6D \uC5F0\uD734 \uB2E8\uC624\uC808, \uCD94\uC11D, \uAD6D\uACBD\uC808 \uAE30\uAC04\uC740 \uBCC4\uB3C4 \uC694\uAE08 \uBB38\uC758 \uBD80\uD0C1\uB4DC\uB9BD\uB2C8\uB2E4.';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'surcharge');

    expect(fact?.values).toMatchObject({ amount: null, percent: null });
    expect(fact?.risk_level).toBe('medium');
    expect(fact?.review_status).toBe('auto_clean');
  });

  it('preserves Japanese-yen surcharge units without converting them to Korean won', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '2인 출발시 송영 추가비용: 1인 2만엔',
        '페어웨이 카트 진입시 550엔/인 추가비용 발생합니다.',
      ].join('\n'),
    });
    const surcharges = result.structuredFacts.filter(row => row.category === 'surcharge');

    expect(surcharges.map(row => row.values)).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 20000, currency: 'JPY' }),
      expect.objectContaining({ amount: 550, currency: 'JPY' }),
    ]));
    expect(surcharges.every(row => row.review_status === 'auto_clean')).toBe(true);
  });

  it('treats amount-less private-event surcharge as an explicit safe inquiry state', () => {
    const rawText = '* 단독행사 요청시 추가 요금 발생합니다.';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'surcharge');

    expect(fact?.values).toMatchObject({ amount: null, percent: null });
    expect(fact?.risk_level).toBe('medium');
    expect(fact?.review_status).toBe('auto_clean');
    expect(fact?.standard_text).toContain('확인');
  });

  it('keeps high-risk missing guide tip values blocked while no-tip stays publishable', async () => {
    const missing = await runProductRegistrationV3([
      '상품: Guide Tip Missing 3D',
      '가격: 599,000원 / 최소출발 4명',
      'DAY 1 KE123 출발 10:00 도착 12:00',
      'DAY 2 City attraction',
      '가이드/기사 팁 별도',
      'DAY 3 KE124 출발 13:00 도착 15:00',
      '포함 호텔 식사',
      '불포함 개인경비',
    ].join('\n'));
    expect(missing.gate_result.status).toBe('blocked');
    expect(missing.gate_result.checks.some(check => check.id.endsWith('high_risk_structured_fact_values') && check.status === 'fail')).toBe(true);

    const noTip = await runProductRegistrationV3([
      '상품: No Tip 3D',
      '가격: 599,000원 / 최소출발 4명',
      'DAY 1 KE123 출발 10:00 도착 12:00',
      'DAY 2 City attraction',
      '포함사항: 기사/가이드팁 포함, 노팁',
      'DAY 3 KE124 출발 13:00 도착 15:00',
      '포함 호텔 식사',
      '불포함 개인경비',
    ].join('\n'));
    expect(noTip.gate_result.checks.find(check => check.id.endsWith('high_risk_structured_fact_values'))?.status).toBe('pass');
  });

  it('does not treat ordinary Korean syllables in visa or attraction lines as meal/surcharge facts', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '-중국비자 필요시 추가 비용 발생 합니다.',
        '-계림의 상징, 기암괴석과 푸른 강의 조화 상비산',
        '-중식 후 하늘 위에서 내려다보는 비경 요산(케이블카)',
        '조:호텔식',
        '중:현지식',
        '석:동북요리',
      ].join('\n'),
    });

    const mealSources = result.standardNotices
      .filter(notice => notice.category === 'meal_plan')
      .map(notice => notice.source_text);
    expect(mealSources).toEqual(['조:호텔식', '중:현지식', '석:동북요리']);
    expect(result.structuredFacts.some(fact =>
      fact.category === 'surcharge' && String(fact.values.label ?? '').includes('중국비자')
    )).toBe(false);
  });
  it('does not turn package operation restrictions into meal notices', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: '패키지 상품은 일정 중 조식 인 등의 개별활동은 불가, 중식 개인자유활동',
    });

    expect(result.standardNotices.some(notice => notice.category === 'meal_plan')).toBe(false);
    expect(result.structuredFacts.some(fact => fact.category === 'meal_plan')).toBe(false);
  });

  it('extracts explicit 추가금 and 챠지 amounts instead of leaving them amountless', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '일본 휴일 숙박 추가금 4,000엔/1일/1인 발생합니다.',
        '2B 챠지 2,200엔/1인/1라운딩 발생합니다.',
        '해당일자 1인/1박/7만원 추가 - 일본공휴일',
      ].join('\n'),
    });

    const surcharges = result.structuredFacts.filter(fact => fact.category === 'surcharge');
    expect(surcharges.map(fact => fact.values.amount)).toEqual(expect.arrayContaining([4000, 2200, 70000]));
    expect(surcharges.every(fact => fact.review_status === 'auto_clean')).toBe(true);
    expect(surcharges[0]?.standard_text).toContain('4,000엔');
  });

  it('marks an amountless summary safe only when a same-topic source line carries the exact amount', () => {
    const covered = extractStructuredFactsFromSupplierText({
      rawText: [
        '일본공휴일 추가비용',
        '일본 휴일 숙박 추가금 4,000엔/1일/1인 발생합니다.',
      ].join('\n'),
    });
    const unresolved = extractStructuredFactsFromSupplierText({
      rawText: '골프장 변경 시 송영요금이 추가로 발생할 수 있습니다.',
    });

    expect(covered.structuredFacts.find(fact =>
      fact.category === 'surcharge' && fact.values.amount == null
    )?.review_status).toBe('auto_clean');
    expect(unresolved.structuredFacts.find(fact =>
      fact.category === 'surcharge'
    )?.review_status).toBe('review_needed');
  });

  it('uses a pre-booking quote and consent contract for conditional substitute transport charges', async () => {
    const source = '골프장 예약 상황에 따라 다른 곳으로 대체될 수 있으며, 송영요금이 추가로 발생할 수 있습니다.';
    const facts = extractStructuredFactsFromSupplierText({
      rawText: source,
      lines: createSourceLineIndex(source),
    });
    const surcharge = facts.structuredFacts.find(fact => fact.category === 'surcharge');

    expect(surcharge?.values).toMatchObject({
      amount: null,
      percent: null,
      safe_state: 'prebooking_quote_and_consent_required',
      charge_timing: 'before_booking_confirmation',
      consent_required: true,
    });
    expect(surcharge?.risk_level).toBe('high');
    expect(surcharge?.review_status).toBe('auto_clean');
    expect(surcharge?.standard_text).toContain('예약 확정 전에 금액을 안내');
    expect(surcharge?.standard_text).toContain('고객 동의');

    const result = await runProductRegistrationV3([
      '상품: 나리타 골프 3박4일',
      '가격: 1,289,000원 / 최소출발 4명',
      'DAY 1 BX112 출발 07:50 도착 10:00',
      source,
      'DAY 4 BX111 출발 10:55 도착 13:15',
      '포함 호텔 식사',
      '불포함 개인경비',
    ].join('\n'));
    expect(result.gate_result.checks.find(check =>
      check.id.endsWith('high_risk_structured_fact_values')
    )?.status).toBe('pass');
    expect(result.gate_result.checks.find(check =>
      check.id.endsWith('prebooking_quote_and_consent_evidence')
    )?.status).toBe('pass');
  });

  it('keeps a generic amountless transport surcharge blocked', () => {
    const source = '송영요금이 추가로 발생할 수 있습니다.';
    const result = extractStructuredFactsFromSupplierText({
      rawText: source,
      lines: createSourceLineIndex(source),
    });
    const surcharge = result.structuredFacts.find(fact => fact.category === 'surcharge');

    expect(surcharge?.values.safe_state).toBeUndefined();
    expect(surcharge?.review_status).toBe('review_needed');
  });

  it('links two-player fee summaries to exact weekend and holiday price details', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '2인라운딩 니세코빌리지코스-2,500엔(주중), 3,500엔(주말, 연휴)/인',
        '5인플레이 불가하여 3인/2인으로 들어가야합니다. 2인 2인라운딩 추가비용 발생',
      ].join('\n'),
    });
    const summary = result.structuredFacts.find(fact =>
      fact.category === 'surcharge'
      && String(fact.values.label ?? '').includes('추가비용 발생')
    );

    expect(summary?.values).toMatchObject({ source_detail_disclosed: true });
    expect(summary?.review_status).toBe('auto_clean');
    expect(summary?.evidence).toHaveLength(2);
  });

  it('links split 2Bag summaries to the exact following two-player charge line', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '2Bag 차지 (카트 추가금) : 1순위) 다른2인신청팀과 조인라운드 필수 / 추가금없음, 2순위) 조인편성',
        '불가능상황 한정 2인라운드 허용 단, 추가금18홀당-주중1인6만원, 주말/일본공휴일 1인9만원',
      ].join('\n'),
    });
    const summary = result.structuredFacts.find(fact =>
      fact.category === 'surcharge'
      && String(fact.values.label ?? '').includes('2Bag')
    );

    expect(summary?.values).toMatchObject({ source_detail_disclosed: true });
    expect(summary?.review_status).toBe('auto_clean');
  });

  it('keeps an amountless ground-cost holiday surcharge blocked', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '일본공휴일 기간은 일본연휴기간으로 지상비추가',
        '2인라운드 추가금18홀당-주중1인6만원, 주말/일본공휴일 1인9만원',
      ].join('\n'),
    });
    const groundCost = result.structuredFacts.find(fact =>
      fact.category === 'surcharge'
      && String(fact.values.label ?? '').includes('지상비추가')
    );

    expect(groundCost?.values).toMatchObject({ amount: null, percent: null });
    expect(groundCost?.review_status).toBe('review_needed');
  });

  it('records an explicit safe state only when exact holiday dates and a source-backed year can be quarantined', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '2026년 7월 출발 상품',
        '일본공휴일 7/18~20, 8/11, 8/14 기간은 일본연휴기간으로 지상비추가',
      ].join('\n'),
    });
    const groundCost = result.structuredFacts.find(fact =>
      fact.category === 'surcharge'
      && String(fact.values.label ?? '').includes('지상비추가')
    );

    expect(groundCost?.values).toMatchObject({
      amount: null,
      percent: null,
      safe_state: 'date_sales_quarantined',
      quarantine_reason: 'unpriced_holiday_ground_cost',
      quarantined_date_tokens: ['7/18~7/20', '8/11', '8/14'],
    });
    expect(groundCost?.values.quarantined_dates).toContain('2026-07-20');
    expect(groundCost?.review_status).toBe('auto_clean');
    expect(groundCost?.standard_text).toContain('판매 대상에서 제외');
  });
});
