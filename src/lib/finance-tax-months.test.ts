import { describe, expect, it } from 'vitest';

import { buildFinanceTaxMonthOptions, isFinanceYearMonth } from './finance-tax-months';

describe('finance tax month options', () => {
  it('builds deterministic previous months without local timezone conversion', () => {
    expect(buildFinanceTaxMonthOptions('2026-08', 4)).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
    expect(buildFinanceTaxMonthOptions('2026-01', 3)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('rejects invalid finance month keys', () => {
    expect(isFinanceYearMonth('2026-08')).toBe(true);
    expect(isFinanceYearMonth('2026-13')).toBe(false);
    expect(buildFinanceTaxMonthOptions('invalid')).toEqual([]);
  });
});
