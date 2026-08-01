import { describe, expect, it } from 'vitest';
import { extractBookingsFromApi } from './bookings-api-response';

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
