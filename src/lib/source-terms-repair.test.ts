import { describe, expect, it } from 'vitest';

import { buildSourceBackedTermsRepair } from './source-terms-repair';

describe('buildSourceBackedTermsRepair', () => {
  it('repairs broken hotel parentheses and over-normalized customer terms from raw sections', () => {
    const rawText = [
      '포    함',
      '▶ 왕복국제선항공료 및 텍스, 유류할증료, 여행자보험',
      '▶ 호텔 숙박, 차량, 한국인 가이드, 관광지 입장료, 일정표 상의 식사',
      '▶ 호이안 관광, 바나산 국립공원 케이블카 체험 & 테마파크 이용',
      '불 포 함',
      '▶ 매너팁 및 마사지팁 (60분 $2, 90분 $3, 120분 $4)',
      'R M K',
    ].join('\n');

    const result = buildSourceBackedTermsRepair({
      raw_text: rawText,
      inclusions: ['왕복항공권', '호텔()'],
      excludes: ['가이드·기사·선장·말 안장 팁 등'],
    });

    expect(result.status).toBe('repaired');
    if (result.status !== 'repaired') throw new Error('expected repair');
    expect(result.inclusions).toContain('호텔 숙박');
    expect(result.inclusions).toContain('한국인 가이드');
    expect(result.inclusions).toContain('바나산 국립공원 케이블카 체험 & 테마파크 이용');
    expect(result.excludes).toEqual(['매너팁 및 마사지팁 (60분 $2, 90분 $3, 120분 $4)']);
  });

  it('does not change already source-backed terms', () => {
    const result = buildSourceBackedTermsRepair({
      raw_text: '상품 안내\n포함\n호텔 숙박\n불포함\n개인경비\n일정 및 항공 안내가 이어집니다. 충분한 원문 길이입니다.',
      inclusions: ['호텔 숙박'],
      excludes: ['개인경비'],
    });

    expect(result.status).toBe('not_needed');
  });
});
