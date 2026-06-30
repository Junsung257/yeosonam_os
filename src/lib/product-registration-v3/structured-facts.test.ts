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

  it('treats no-tip and included guide tip as an explicit safe state', () => {
    const rawText = '포함사항: 기사/가이드팁 포함, 노팁 상품';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(fact?.values).toMatchObject({ included: true, amount: null });
    expect(fact?.review_status).toBe('auto_clean');
    expect(result.customerFieldPatch.guide_tip).toBe('포함');
    expect(result.standardNotices[0]?.standard_text).toBe('가이드/기사 팁은 포함되어 있습니다.');
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
});
