import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('customer recommendation comparison copy', () => {
  it('keeps recommendation surfaces free of mojibake and internal scoring language', () => {
    const combined = [
      source('src/components/customer/RecommendationCard.tsx'),
      source('src/components/customer/PairwiseCompareModal.tsx'),
    ].join('\n');

    expect(combined).not.toMatch(/[�]|李|吏|鍮|媛|嫄|꾩|쨌|鍮꾧|異붿/);
    expect(combined).not.toMatch(/TOPSIS|헤도닉|랜드사 신뢰도|Decision guide|internal|ground truth/i);
    expect(combined).not.toMatch(/예약 즉시|항공·숙박 확보|좌석 확보|최저가 보장|100% 보장|즉시 확정|무조건 출발/);
  });

  it('uses conservative customer wording for price and hotel comparisons', () => {
    const card = source('src/components/customer/RecommendationCard.tsx');
    const modal = source('src/components/customer/PairwiseCompareModal.tsx');

    expect(card).toContain('같은 출발일 비교 기준');
    expect(card).toContain('실제 가능 여부와 요금은 상담 시점에 다시 확인합니다');
    expect(modal).toContain('호텔 조건 우수');
    expect(modal).not.toContain('성급 기준');
  });
});
