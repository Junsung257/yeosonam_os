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
});
