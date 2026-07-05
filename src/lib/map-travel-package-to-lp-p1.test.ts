import { describe, expect, it } from 'vitest';

import { isUpcomingKstDate } from '@/lib/kst-date';
import { mapTravelPackageToLandingData } from './map-travel-package-to-lp';

describe('mapTravelPackageToLandingData P1 hardening', () => {
  it('carries inbound next-day arrival into LP flight summary', () => {
    const mapped = mapTravelPackageToLandingData({
      id: 'pkg-next-day',
      title: 'Nha Trang 3N5D',
      destination: 'Nha Trang',
      duration: 5,
      price: 1099000,
      price_dates: [{ date: '2026-08-30', price: 1099000, confirmed: false }],
      inclusions: [],
      excludes: [],
      itinerary_data: {
        days: [
          { day: 1, regions: ['Nha Trang'], meals: {}, schedule: [{ activity: 'Busan departure', type: 'flight' }] },
          { day: 5, regions: ['Busan'], meals: {}, schedule: [{ activity: 'Busan arrival', type: 'flight' }] },
        ],
        flight_segments: [
          { leg: 'outbound', flight_no: 'BX781', dep_time: '19:20', arr_time: '22:20', arr_day_offset: 0, day_pair: [0, 0] },
          { leg: 'inbound', flight_no: 'BX782', dep_time: '23:20', arr_time: '06:20', arr_day_offset: 1, day_pair: [4, 4] },
        ],
      },
    } as unknown as Record<string, unknown>, null);

    expect(mapped.flightSummary?.inbound?.arrDayOffset).toBe(1);
  });

  it('does not treat invalid ISO-like dates as upcoming KST dates', () => {
    expect(isUpcomingKstDate('2026-99-99', '2026-01-01')).toBe(false);
    expect(isUpcomingKstDate('2026-02-30', '2026-01-01')).toBe(false);
  });

  it('keeps invalid ISO-like dates unknown on the LP payload', () => {
    const mapped = mapTravelPackageToLandingData({
      id: 'pkg-invalid-date',
      title: 'Invalid date test',
      destination: 'Osaka',
      duration: 3,
      price: 599000,
      price_dates: [{ date: '2026-02-30', price: 599000, confirmed: false }],
      inclusions: [],
      excludes: [],
      itinerary_data: {
        days: [
          { day: 1, regions: ['Osaka'], meals: {}, schedule: [{ activity: 'Busan departure', type: 'flight' }] },
        ],
      },
    } as unknown as Record<string, unknown>, null);

    expect(mapped.departureFullDate).toBeNull();
  });
});
