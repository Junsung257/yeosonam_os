import { describe, expect, it } from 'vitest';
import { extractBookingFromApi, extractBookingsFromApi } from './bookings-api-response';

describe('extractBookingsFromApi', () => {
  it('reads the standardized API response', () => {
    expect(extractBookingsFromApi<{ id: string }>({
      ok: true,
      data: { bookings: [{ id: 'BK-1' }] },
    })).toEqual([{ id: 'BK-1' }]);
  });

  it('keeps compatibility with the legacy response', () => {
    expect(extractBookingsFromApi<{ id: string }>({
      bookings: [{ id: 'BK-2' }],
    })).toEqual([{ id: 'BK-2' }]);
  });

  it('returns an empty list for invalid payloads', () => {
    expect(extractBookingsFromApi(null)).toEqual([]);
    expect(extractBookingsFromApi({ ok: false })).toEqual([]);
  });
});

describe('extractBookingFromApi', () => {
  it('reads the standardized API response', () => {
    expect(extractBookingFromApi<{ id: string }>({
      ok: true,
      data: { booking: { id: 'BK-1' } },
    })).toEqual({ id: 'BK-1' });
  });

  it('keeps compatibility with the legacy response', () => {
    expect(extractBookingFromApi<{ id: string }>({
      booking: { id: 'BK-2' },
    })).toEqual({ id: 'BK-2' });
  });

  it('returns null for invalid payloads', () => {
    expect(extractBookingFromApi(null)).toBeNull();
    expect(extractBookingFromApi({ ok: false })).toBeNull();
  });
});
