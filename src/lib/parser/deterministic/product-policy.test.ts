import { describe, it, expect } from 'vitest';
import {
  detectCatalogProductFlags,
  applyNoTipPolicy,
  stripFalseTipInclusions,
  inferProductTypeFromTitle,
} from './product-policy';

describe('detectCatalogProductFlags', () => {
  it('노팁,노옵션 제목에서 noTip·noOption', () => {
    const f = detectCatalogProductFlags('노팁,노옵션 BX 다낭/호이안 특급호텔 3박5일', '');
    expect(f.noTip).toBe(true);
    expect(f.noOption).toBe(true);
  });
});

describe('applyNoTipPolicy', () => {
  it('노팁 상품 — POLICY 유의사항 + excludes 팁 불포함', () => {
    const { notices, excludes } = applyNoTipPolicy([], ['개인경비'], { noTip: true, noOption: true, noShopping: false });
    expect(notices.some(n => n.type === 'POLICY' && /포함되지 않/.test(n.text))).toBe(true);
    expect(excludes.some(x => /팁/.test(x))).toBe(true);
  });
});

describe('stripFalseTipInclusions', () => {
  it('노팁 상품 inclusions 에서 팁 포함 환각 제거', () => {
    const out = stripFalseTipInclusions(
      ['항공료', '가이드·기사 팁 포함', '숙박'],
      { noTip: true, noOption: false, noShopping: false },
    );
    expect(out).toEqual(['항공료', '숙박']);
  });
});

describe('inferProductTypeFromTitle', () => {
  it('노팁+노옵션 제목 → 노팁', () => {
    expect(inferProductTypeFromTitle('노팁,노옵션 BX 다낭', null)).toBe('노팁');
  });
});
