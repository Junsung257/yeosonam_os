import { describe, expect, it } from 'vitest';

import {
  formatBookingDateKo,
  getBookingDayOffset,
  getKstDateKey,
} from './booking-list-calendar';

describe('booking list KST calendar', () => {
  it('pins the reference date to Korea across the UTC midnight boundary', () => {
    expect(getKstDateKey(Date.parse('2026-08-24T14:59:59Z'))).toBe('2026-08-24');
    expect(getKstDateKey(Date.parse('2026-08-24T15:00:00Z'))).toBe('2026-08-25');
  });

  it('computes D-day by calendar dates without the runtime local timezone', () => {
    expect(getBookingDayOffset('2026-08-25', '2026-08-25')).toBe(0);
    expect(getBookingDayOffset('2026-09-01', '2026-08-25')).toBe(7);
    expect(getBookingDayOffset('2026-08-18', '2026-08-25')).toBe(-7);
  });

  it('rejects invalid dates and formats weekdays from UTC calendar fields', () => {
    expect(getBookingDayOffset('2026-02-30', '2026-08-25')).toBeNull();
    expect(formatBookingDateKo('2026-08-25')).toBe('26-08-25 (화)');
    expect(formatBookingDateKo('invalid')).toBe('invalid');
  });
});
