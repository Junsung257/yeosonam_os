import { describe, expect, it } from 'vitest';

import { resolveLeadDefaultDate } from './LeadBottomSheet';

describe('resolveLeadDefaultDate', () => {
  it('clears an expired default when only past source departures remain', () => {
    expect(resolveLeadDefaultDate('2026-08-25', [
      { date: '2026-08-25', price: 539_000, confirmed: false },
      { date: '2026-08-31', price: 499_000, confirmed: false },
    ], '2026-09-01')).toBe('');
  });

  it('keeps a default only when it is an upcoming selectable source date', () => {
    expect(resolveLeadDefaultDate('2026-09-10', [
      { date: '2026-09-10', price: 599_000, confirmed: true },
    ], '2026-09-01')).toBe('2026-09-10');
  });

  it('allows an upcoming requested date when the source has no dated price rows', () => {
    expect(resolveLeadDefaultDate('2026-09-12', [], '2026-09-01')).toBe('2026-09-12');
  });
});
