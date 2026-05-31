import { describe, expect, it } from 'vitest';
import { buildSupplierFormatFingerprint } from './supplier-format-fingerprint';

describe('supplier format fingerprint', () => {
  it('keeps similar supplier formats stable while masking facts', () => {
    const a = `상품명: [A] 나트랑 3박5일
출발편 LJ115 21:35 부산 출발
출발일: 2026-06-04
요금표
성인 619,000원
일정표
1일차 부산/나트랑`;
    const b = `상품명: [B] 나트랑 3박5일
출발편 LJ116 22:35 부산 출발
출발일: 2026-07-11
요금표
성인 719,000원
일정표
1일차 부산/나트랑`;

    const fa = buildSupplierFormatFingerprint(a);
    const fb = buildSupplierFormatFingerprint(b);

    expect(fa.formatHash).toBe(fb.formatHash);
    expect(fa.normalizedPreview).toContain('<FLIGHT>');
    expect(fa.normalizedPreview).toContain('<KRW>');
    expect(fa.sections.some(s => s.label === 'price')).toBe(true);
    expect(fa.sections.find(s => s.label === 'price')?.hash)
      .toBe(fb.sections.find(s => s.label === 'price')?.hash);
    expect(fa.sections.find(s => s.label === 'price')?.exactHash)
      .not.toBe(fb.sections.find(s => s.label === 'price')?.exactHash);
  });

  it('keeps exact section hashes stable for identical facts with whitespace drift', () => {
    const a = `?붽툑??\n?깆씤 619,000?? / ?꾨룞 619,000??`;
    const b = `?붽툑??\r\n  ?깆씤   619,000??   /   ?꾨룞 619,000??  `;

    const fa = buildSupplierFormatFingerprint(a);
    const fb = buildSupplierFormatFingerprint(b);

    expect(fa.sections[0].exactHash).toBe(fb.sections[0].exactHash);
  });
});
