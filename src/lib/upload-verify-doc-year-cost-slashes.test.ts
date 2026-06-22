import { describe, expect, it } from 'vitest';

import { evaluateVerifyChecks } from './upload-verify';

function findCheck(result: ReturnType<typeof evaluateVerifyChecks>, id: string) {
  return result.checks.find(check => check.id === id);
}

describe('upload verify document year with local cost slashes', () => {
  it('ignores slash-formatted local costs when deciding document-year rollover', () => {
    const rawText = `
PKG ZE Phu Quoc golf 4N6D
2026.2.1
3/1~3/31
토
1,319,-
개인경비, 캐디팁($20/50만동/18홀/인), 클럽중식($15~/인)
미팅/샌딩/송영차량비($65/1인-4인기준, $260-3인기준)
`;

    const result = evaluateVerifyChecks({
      id: 'pkg-phu-quoc-doc-year-cost-slashes',
      title: 'PKG ZE Phu Quoc golf 4N6D',
      duration: 6,
      raw_text: rawText,
      departure_days: '토',
      price_dates: [
        { date: '2027-03-06', price: 1319000 },
        { date: '2027-03-13', price: 1319000 },
        { date: '2027-03-20', price: 1319000 },
        { date: '2027-03-27', price: 1319000 },
      ],
    });

    expect(findCheck(result, 'C12')?.status).toBe('pass');
    expect(findCheck(result, 'C14')?.status).toBe('pass');
  });
});
