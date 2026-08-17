import { describe, expect, it } from 'vitest';

import { attachSharedDocumentContext, inferSharedDocumentContext } from './document-context';

describe('commercial context graph', () => {
  it('inherits one inline terminal inclusion/exclusion pair after the last itinerary', () => {
    const source = [
      '[A] 다낭 3박5일',
      '1일차: 인천 출발',
      '[B] 다낭 골프 3박5일',
      '1 일 차: 부산 출발',
      '포 함 내역: 왕복 항공료, 호텔, 조식',
      '불 포 함 내역: 가이드팁, 개인경비',
      '취소 및 환불 규정',
      '출발 20일 전부터 취소료가 적용됩니다.',
    ].join('\n');

    const blocks = inferSharedDocumentContext(source);
    expect(blocks.map(block => block.kind)).toEqual(['inclusions', 'exclusions', 'cancellation']);
    const attached = attachSharedDocumentContext('[A] 다낭 3박5일\n1일차: 인천 출발', blocks);
    expect(attached).toContain('왕복 항공료');
    expect(attached).toContain('가이드팁');
    expect(attached).toContain('출발 20일 전부터');
  });

  it('does not inherit repeated product-specific commercial headings', () => {
    const blocks = inferSharedDocumentContext([
      '[A] 상품', '1일차: 일정', '포함: A 전용', '불포함: A 전용',
      '[B] 상품', '1일차: 일정', '포함: B 전용', '불포함: B 전용',
    ].join('\n'));
    expect(blocks).toEqual([]);
  });
});
