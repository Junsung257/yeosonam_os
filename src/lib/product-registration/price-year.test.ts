import { describe, expect, it } from 'vitest';

import { inferSourceBackedPriceYear, resolvePriceRecoveryYear } from './price-year';

describe('price year inference', () => {
  it('uses source-backed product price year and ignores notice-only past years', () => {
    const rawText = `
ZE Phu Quoc 2 color golf
regular fare distributed 2026.2.1
3/1~3/31
1,319,-

PKG ZE Phu Quoc golf 3n5d
2026.2.1
price table reference

Notice: Vietnam e-cigarette rule changed from 2025.
`;

    expect(inferSourceBackedPriceYear(rawText)).toBe(2026);
    expect(resolvePriceRecoveryYear({ rawText })).toBe(2026);
  });

  it('keeps an explicit caller year ahead of raw text inference', () => {
    expect(resolvePriceRecoveryYear({
      explicitYear: 2027,
      rawText: 'PKG sample 2026.2.1 price table',
    })).toBe(2027);
  });

  it('infers Korean two-digit years from product price-table context', () => {
    const rawText = `
\u2605\ubd80\uc0b0-\ud478\uafb8\uc625 26\ub1446\uc6d4~10\uc6d4 \uc9c4\uc5d0\uc5b4 \ud328\ud0a4\uc9c0(3/4\ubc15)\u2605\uc815\uaddc\uc694\uae08
6/1-7/23
\uc6d4\ubaa9\uae08
879,000

\ud478\uafb8\uc625 \uc368\ucc28\uc9c0
26/08/29 ~ 26/09/02
`;

    expect(inferSourceBackedPriceYear(rawText)).toBe(2026);
    expect(resolvePriceRecoveryYear({ rawText })).toBe(2026);
  });

  it('returns undefined when the only year is notice context', () => {
    expect(resolvePriceRecoveryYear({
      rawText: 'Notice: e-cigarette rule changed from 2025. Cancellation policy applies.',
    })).toBeUndefined();
  });
});
