import { describe, expect, it } from 'vitest';
import { checkAiReadability } from './blog-quality-gate';
import { repairBlogAiReadableStructure } from './blog-ai-readable-repair';
import type { BlogInformationClaimInput } from './blog-information-evidence';

function claim(claimText: string): BlogInformationClaimInput {
  return {
    claimFingerprint: claimText,
    claimText,
    claimType: 'price',
    riskLevel: 'MEDIUM',
    requiresEvidence: true,
    evidenceKeys: ['verified-source'],
  };
}

const claims = [
  claim('삿포로 일반 여행자의 절약형 1인 하루 식비는 3,460 JPY입니다.'),
  claim('삿포로 일반 여행자의 일반형 1인 하루 식비는 7,974 JPY입니다.'),
  claim('삿포로 일반 여행자의 여유형 1인 하루 식비는 15,644 JPY입니다.'),
  claim('삿포로 일반 여행자의 아침 식사 범위는 5-15 USD입니다.'),
  claim('삿포로 일반 여행자의 점심 식사 범위는 8-20 USD입니다.'),
  claim('삿포로 일반 여행자의 저녁 식사 범위는 15-36 USD입니다.'),
  claim('삿포로 일반 여행자의 간식·커피 기준 가격은 4 USD입니다.'),
];

describe('repairBlogAiReadableStructure', () => {
  it('keeps the final H2 budget while preserving a question and evidence-backed FAQ', () => {
    const markdown = [
      '# 삿포로 식비 예산',
      '',
      '삿포로 식비 예산은 여행 전에 비교해야 할 핵심 준비 항목입니다.',
      '',
      '- 절약형·일반형·여유형을 비교합니다.',
      '- 끼니별 범위를 비교합니다.',
      '',
      ...Array.from({ length: 10 }, (_, index) => `## 구간 ${index + 1} 가격 차이 확인 방법\n\n본문 ${index + 1}`),
    ].join('\n');

    const result = repairBlogAiReadableStructure({
      markdown,
      keyword: '삿포로 식비 예산',
      intent: 'food_budget',
      approvedClaims: claims,
    });

    expect((result.markdown.match(/^##\s+\S/gm) || [])).toHaveLength(9);
    expect(result.markdown).toMatch(/^##\s+.+\?$/m);
    expect(result.markdown).toContain('## 자주 묻는 질문');
    for (const item of claims) expect(result.markdown).toContain(item.claimText);
    expect(checkAiReadability(result.markdown, 'info').passed).toBe(true);
  });

  it('does not invent an FAQ when approved claims are unavailable', () => {
    const markdown = '# 여행 준비\n\n여행 준비는 조건을 먼저 확인하는 과정입니다.\n\n## 준비 기준\n\n- 조건 확인\n- 일정 비교';
    const result = repairBlogAiReadableStructure({
      markdown,
      keyword: '여행 준비',
      intent: 'general',
    });

    expect(result.markdown).toMatch(/^##\s+.+\?$/m);
    expect(result.markdown).not.toContain('자주 묻는 질문');
  });
});
