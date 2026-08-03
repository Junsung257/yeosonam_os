import { describe, expect, it } from 'vitest';

import { getBookingReceivable } from './booking-settlement-display';

describe('getBookingReceivable', () => {
  it('does not present money received before price entry as a negative receivable', () => {
    expect(getBookingReceivable(0, 1_238_000)).toBeNull();
    expect(getBookingReceivable(undefined, 800_000)).toBeNull();
  });

  it('returns the non-negative receivable after the sales price is entered', () => {
    expect(getBookingReceivable(1_500_000, 800_000)).toBe(700_000);
    expect(getBookingReceivable(1_500_000, 1_600_000)).toBe(0);
  });
});
