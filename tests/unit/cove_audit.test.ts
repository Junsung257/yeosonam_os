import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { extractClaims } = require('../../db/cove_audit.js') as {
  extractClaims: (pkg: Record<string, unknown>) => Array<{ field: string; text: string }>;
};

describe('cove_audit extractClaims', () => {
  it('does not spend CoVe tokens on PAYMENT notices copied exactly from raw text', () => {
    const claims = extractClaims({
      raw_text: `발권마감 출발 7일 전

불포함사항
가이드/기사 경비, 개인경비 및 매너팁`,
      notices_parsed: [
        {
          type: 'PAYMENT',
          title: '추가 비용 안내',
          text: '• 발권마감 출발 7일 전\n• 가이드/기사 경비, 개인경비 및 매너팁',
        },
      ],
    });

    expect(claims.filter(c => c.field === 'notices_parsed')).toHaveLength(0);
  });

  it('keeps CoVe checks for PAYMENT notices without raw evidence', () => {
    const claims = extractClaims({
      raw_text: '발권마감 출발 7일 전',
      notices_parsed: [
        {
          type: 'PAYMENT',
          title: '추가 비용 안내',
          text: '• 리조트피 1인 50달러 현지 결제',
        },
      ],
    });

    expect(claims.some(c => c.field === 'notices_parsed')).toBe(true);
  });
});
