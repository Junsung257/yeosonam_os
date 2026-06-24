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
