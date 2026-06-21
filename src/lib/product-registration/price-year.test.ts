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

  it('returns undefined when the only year is notice context', () => {
    expect(resolvePriceRecoveryYear({
      rawText: 'Notice: e-cigarette rule changed from 2025. Cancellation policy applies.',
    })).toBeUndefined();
  });
});
