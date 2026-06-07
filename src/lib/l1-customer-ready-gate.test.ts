import { describe, expect, it } from 'vitest';
import { evaluateL1CustomerReadyGate, decidePackageStatusFromL1 } from './l1-customer-ready-gate';
import { isSynthesizedRawText } from './packages/raw-text';

describe('isSynthesizedRawText', () => {
  it('detects field-synthesized stub pattern', () => {
    const stub = `# 테스트 상품
목적지: 다낭
## 상품 소개
요약 텍스트`;
    expect(isSynthesizedRawText(stub)).toBe(true);
  });

  it('does not flag real PDF paste', () => {
    const real = `PKG 노팁노옵션 다낭 3박5일
일 자 : 1일차
비 고 : 쇼핑 2회`;
    expect(isSynthesizedRawText(real)).toBe(false);
  });
});

describe('evaluateL1CustomerReadyGate', () => {
  it('blocks empty itinerary (M7)', () => {
    const gate = evaluateL1CustomerReadyGate({
      row: {
        title: '테스트',
        raw_text: 'PKG 테스트 상품 일정표',
        inclusions: ['왕복항공'],
        excludes: ['매너팁'],
        notices_parsed: [
          { type: 'CRITICAL', title: 'a', text: 'b' },
          { type: 'PAYMENT', title: 'a', text: 'b' },
          { type: 'POLICY', title: 'a', text: 'b' },
          { type: 'INFO', title: 'a', text: 'b' },
        ],
        itinerary_data: { days: [] },
      },
      internalCode: 'PUS-ETC-DAD-05-0009',
      rawText: 'PKG 테스트',
    });
    expect(gate.codes).toContain('M7_NO_ITINERARY');
    expect(gate.reasons.length).toBeGreaterThan(0);
    expect(decidePackageStatusFromL1(gate, { confidence: 0.99 })).toBe('pending_review');
  });

  it('blocks critical commission leak', () => {
    const gate = evaluateL1CustomerReadyGate({
      row: {
        title: '나트랑',
        raw_text: 'PKG 나트랑',
        notices_parsed: [{ type: 'INFO', title: 't', text: '커미션 10% 포함 안내' }],
        inclusions: [],
        excludes: [],
        itinerary_data: {
          days: [{ day: 1, schedule: [{ type: 'normal', activity: '시내 관광' }] }],
        },
      },
      internalCode: 'PUS-ETC-NHA-05-0001',
      rawText: 'PKG 나트랑',
    });
    expect(gate.codes.some(c => c.startsWith('LEAK_'))).toBe(true);
    expect(decidePackageStatusFromL1(gate, { confidence: 0.99 })).toBe('pending_review');
  });

  it('blocks synthesized raw stub', () => {
    const stub = `# 장가계
목적지: 장가계
## 포함 사항
- 항공`;
    const gate = evaluateL1CustomerReadyGate({
      row: {
        title: '장가계',
        raw_text: stub,
        itinerary_data: { days: [{ day: 1, schedule: [{ activity: 'tour' }] }] },
      },
      shortCode: 'XX-ETC-ZJJ-05-0001',
      rawText: stub,
    });
    expect(gate.codes).toContain('STUB_RAW_TEXT');
  });

  it('blocks pasted itinerary table fragments before customer exposure', () => {
    const gate = evaluateL1CustomerReadyGate({
      row: {
        title: 'BX나리타 치바 죠시 골프 54H 3박4일',
        raw_text: 'PKG\nBX나리타 치바 죠시 골프 54H 3박4일',
        notices_parsed: [
          { type: 'CRITICAL', title: 't', text: '여권은 출발일 기준 6개월 이상 남아 있어야 합니다.' },
          { type: 'PAYMENT', title: 't', text: '9홀 추가 챠지 1인 3,800엔 추가' },
          { type: 'POLICY', title: 't', text: '문신이 있는 경우 골프장 및 목욕탕 사용이 불가합니다.' },
          { type: 'INFO', title: 't', text: '차량 배차 상황에 따라 대기 시간이 발생할 수 있습니다.' },
        ],
        inclusions: ['왕복항공료(15KG)', '식사(조식,중식)'],
        excludes: ['기타개인경비'],
        itinerary_data: {
          days: [
            {
              day: 1,
              schedule: [
                { type: 'normal', activity: 'BX112' },
                { type: 'normal', activity: '10:00' },
                { type: 'normal', activity: 'HOTEL: 호텔 죠시 또는 동급' },
              ],
            },
          ],
        },
      },
      internalCode: 'PUS-ETC-TYO-04-0009',
      rawText: 'PKG\nBX나리타 치바 죠시 골프 54H 3박4일',
    });

    expect(gate.reasons.join('\n')).toContain('일정표 표 조각');
    expect(gate.codes).toEqual(expect.arrayContaining([
      'ITINERARY_SCHEDULE_FLIGHT_CODE_ONLY',
      'ITINERARY_SCHEDULE_TIME_ONLY',
      'ITINERARY_SCHEDULE_HOTEL_LINE',
    ]));
    expect(decidePackageStatusFromL1(gate, { confidence: 0.99 })).toBe('pending_review');
  });
});
