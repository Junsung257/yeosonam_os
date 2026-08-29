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

  it('does not turn a conditional no-shopping quote into a product contradiction', () => {
    const rawText = [
      '노옵션노팁 쇼핑1회',
      '※노쇼핑 견적시 쇼핑일정없음',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const shoppingFacts = result.structuredFacts.filter(row => row.category === 'shopping_policy');
    expect(shoppingFacts.some(row => row.values.none === true)).toBe(false);
  });

  it('does not mark a conditional no-shopping price as a no-shopping product', () => {
    const rawText = '노옵션 진행시 성인 100,000원 / 노쇼핑 진행시 성인 100,000원 / 쇼핑센터 3회';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const shoppingFacts = result.structuredFacts.filter(row => row.category === 'shopping_policy');

    expect(shoppingFacts.some(row => row.values.none === true)).toBe(false);
    expect(result.standardNotices.some(row => row.template_key === 'shopping.none')).toBe(false);
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

  it('does not confuse a separate massage tip with an included guide tip', () => {
    const rawText = '포함사항: 왕복항공료, 호텔, 차량, 가이드, 전통마사지 2시간(팁별도)';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });

    expect(result.structuredFacts.some(row => row.category === 'guide_tip')).toBe(false);
    expect(result.standardNotices.some(row => row.template_key === 'guide.tip_included')).toBe(false);
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

  it('treats a leading-star exclusion row as a local guide-tip notice', () => {
    const rawText = '* 불포함 : 기사&기사팁[3박-$30/4박-$40], 개인경비';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const guideTip = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(guideTip?.values).toMatchObject({ included: false, amount: 30, currency: 'USD' });
    expect(result.standardNotices.some(notice => notice.template_key === 'guide.tip_included')).toBe(false);
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

  it('treats season holiday extra-fee inquiry as an explicit safe inquiry state', () => {
    const rawText = '* \uC911\uAD6D \uC5F0\uD734 \uB2E8\uC624\uC808, \uCD94\uC11D, \uAD6D\uACBD\uC808 \uAE30\uAC04\uC740 \uBCC4\uB3C4 \uC694\uAE08 \uBB38\uC758 \uBD80\uD0C1\uB4DC\uB9BD\uB2C8\uB2E4.';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'surcharge');

    expect(fact?.values).toMatchObject({ amount: null, percent: null });
    expect(fact?.risk_level).toBe('medium');
    expect(fact?.review_status).toBe('auto_clean');
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

  it('degrades high-risk missing guide tip values to source-bound inquiry while no-tip stays publishable', async () => {
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
    expect(missing.gate_result.checks.some(check => check.id.endsWith('high_risk_structured_fact_values') && check.status === 'fail')).toBe(false);
    expect(missing.ledger.variants[0]?.structured_facts.find(fact => fact.category === 'guide_tip')?.standard_text).toContain('예약 시 확인');

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

  it('reads a won-symbol guide fee as excluded even when the source word contains 불포함', async () => {
    const result = await runProductRegistrationV3([
      '상품: 북큐슈 2박3일 PKG',
      '가격: 599,000원 / 최소출발 4명',
      'DAY 1 BX142 출발 10:00 도착 10:55',
      'DAY 2 유후인 관광',
      '★ 불포함 – 개인경비, 기사&가이드경비 ￦30,000',
      'DAY 3 BX143 출발 19:55 도착 21:00',
      '포함 호텔 식사',
    ].join('\n'));
    const guideTip = result.ledger.variants[0]?.structured_facts.find(fact => fact.category === 'guide_tip');

    expect(guideTip?.values).toMatchObject({ included: false, amount: 30_000, currency: '원', payment: 'local' });
    expect(guideTip?.review_status).toBe('auto_clean');
    expect(result.gate_result.checks.find(check => check.id.endsWith('high_risk_structured_fact_values'))?.status).toBe('pass');
  });

  it('does not borrow a single-room charge as the guide-tip amount', () => {
    const source = '유류변동분, 싱글차지(200,000원/인/전일정), 개인경비 및 매너팁, 기사 가이드팁';
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');
    const notice = result.standardNotices.find(row => row.template_key === 'guide.tip_amount_local_payment');

    expect(fact?.values).toMatchObject({ included: false, amount: null, currency: null });
    expect(notice?.values.amount).toBeNull();
    expect(notice?.review_status).toBe('review_needed');
    expect(notice?.standard_text).toContain('예약 시 확인');
  });

  it('does not apply a massage-tip exclusion to an included guide expense in another clause', () => {
    const source = [
      '포 함 내 역',
      '여행자보험(1억원), 발+전신마사지(90분/팁별도), 특급호텔숙박+온천욕, 특식3회, 기사/가이드경비',
      '불포함 내역',
      '기타개인경비',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
    expect(guideTips[0]?.review_status).toBe('auto_clean');
    expect(result.standardNotices.some(notice => notice.template_key === 'guide.tip_amount_local_payment')).toBe(false);
  });

  it('keeps an amount-less guide benefit in the active inclusion section when a later exclusion heading is nearby', () => {
    const source = [
      '포 함',
      '기사/가이드팁, 왕조성지온천욕, 발+전신마사지(60분), 특식 2회',
      '연길 핫플 민속촌',
      '불 포 함',
      '유류할증료 변동분, 싱글차지, 개인경비 및 매너팁',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
    expect(guideTips[0]?.review_status).toBe('auto_clean');
  });

  it('treats an amount-bearing guide fee before a reversed exclusion heading as local payment', () => {
    const source = [
      '포 함 내 역',
      '항공료, 호텔, 일정상 표기된 식사',
      '기사 & 가이드 경비 $50/인, 아시아 관광세 MYR10/룸/박, 개인 경비 및 매너팁',
      '불포함 내역',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: false, amount: 50, currency: 'USD', payment: 'local' });
    expect(guideTips[0]?.review_status).toBe('auto_clean');
  });

  it('recognizes a spaced inclusion heading and keeps the following guide tip included', () => {
    const source = [
      '[BX] 다낭/호이안 노팁노옵션 PKG 3박5일',
      '포 함 사 항',
      '일정상의 관광지입장료 및 식사, 기사 및 한국인가이드 팁',
      '불 포 함',
      '개인경비 및 매너 팁, 싱글차지',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
  });

  it('does not join a free-day guide service clause with a separate etiquette-tip clause', () => {
    const source = [
      '[BX] 나트랑 노팁/노쇼핑 3박5일',
      '포 함',
      '나트랑 야간시티투어+가이드/기사 팁',
      '불 포 함',
      '1일차 석식, 2일차 가이드/차량/중석식 ▶ 에티켓팁, 기타 개인경비',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips).toHaveLength(1);
    expect(guideTips[0]?.values).toMatchObject({ included: true, amount: null });
  });

  it('preserves an amount-less guide tip inside an explicit exclusion section when no-tip conflicts', () => {
    const source = [
      '포함사항: 기사/가이드팁 포함, 노팁 상품',
      '불 포 함',
      '유류변동분, 싱글차지(200,000원/인/전일정), 개인경비 및 매너팁, 기사 가이드팁',
    ].join('\n');
    const result = extractStructuredFactsFromSupplierText({ rawText: source });
    const guideTips = result.structuredFacts.filter(row => row.category === 'guide_tip');

    expect(guideTips.some(row => (
      row.values.included === false
      && row.values.amount == null
      && row.review_status === 'review_needed'
    ))).toBe(true);
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

  it('does not describe optional-tour transport as included transportation', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '선택관광: 노산 케이블카 $100/인',
        '관광: 야경유람선 $50, 노산(케이블카) $100',
        '♣추천선택관광: 해천뷰전망대 케이블카왕복 $50/인',
        '제2일 전용차량으로 시내 이동',
      ].join('\n'),
    });
    const transports = result.structuredFacts
      .filter(fact => fact.category === 'transport')
      .flatMap(fact => fact.values.items as string[]);

    expect(transports).toEqual(['전용차량']);
    expect(result.standardNotices.some(notice => (
      notice.template_key === 'transport.included'
      && (notice.values.items as string[]).includes('케이블카')
    ))).toBe(false);
  });

  it('uses natural Korean particles in customer meal copy', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: ['특식', '중:현지식', '석:샤브샤브'].join('\n'),
    });
    const messages = result.standardNotices
      .filter(notice => notice.category === 'meal_plan')
      .map(notice => notice.standard_text);

    expect(messages).toEqual(expect.arrayContaining([
      '일정표 기준 식사는 특식으로 제공됩니다.',
      '일정표 기준 식사는 중식 현지식으로 제공됩니다.',
      '일정표 기준 식사는 석식 샤브샤브로 제공됩니다.',
    ]));
  });

  it('does not publish incomplete meal fragments created by HWP cell wrapping', () => {
    const result = extractStructuredFactsFromSupplierText({
      rawText: [
        '하산 후 석식 및 호텔투숙',
        '중:김밥 또는',
        '도시락',
        '석:호텔식',
      ].join('\n'),
    });
    const messages = result.standardNotices
      .filter(notice => notice.category === 'meal_plan')
      .map(notice => notice.standard_text);

    expect(messages).toEqual(['일정표 기준 식사는 석식 호텔식으로 제공됩니다.']);
    expect(messages.some(message => /또는으로|호텔투숙으로/u.test(message))).toBe(false);
  });
});
