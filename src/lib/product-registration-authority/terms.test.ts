import { describe, expect, it } from 'vitest';

import { buildCanonicalTermsRevisions } from './terms';

describe('canonical terms revisions', () => {
  it('keeps cancellation and commercial terms source-bound', () => {
    const rows = buildCanonicalTermsRevisions({
      sections: [{
        v3: { ledger: { variants: [{
          inclusions: [{ value: '왕복 항공료 포함' }],
          exclusions: [{ value: '가이드 경비 불포함' }],
          options: [],
          shopping: [],
          standard_notices: [{ category: 'cancel', source_text: '출발 20일 전 취소 수수료' }],
        }] } },
      }],
    });
    expect(rows.map(row => row.termsType)).toEqual(['inclusion', 'exclusion', 'cancellation']);
    expect(rows.every(row => /^[0-9a-f]{64}$/.test(row.termsHash))).toBe(true);
  });

  it('does not invent cancellation terms when the source has none', () => {
    const rows = buildCanonicalTermsRevisions({ sections: [{ v3: { ledger: { variants: [{ inclusions: [] }] } } }] });
    expect(rows.some(row => row.termsType === 'cancellation')).toBe(false);
  });

  it('keeps typed meal facts out of commercial and legal terms', () => {
    const rows = buildCanonicalTermsRevisions({
      sections: [{
        v3: { ledger: { variants: [{
          inclusions: [], exclusions: [], options: [], shopping: [],
          standard_notices: [{
            category: 'meal_plan',
            source_text: '티업 시간 때문에 이용하지 못한 조식 비용은 환불되지 않습니다.',
            standard_text: '조식 비용은 환불되지 않습니다.',
          }],
        }] } },
      }],
    });

    expect(rows).toEqual([]);
  });
});
