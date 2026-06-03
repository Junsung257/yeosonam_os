import { describe, expect, it } from 'vitest';

import { buildUploadRegisterReport } from './product-registration-register-report';

const pkg = {
  id: 'pkg-123',
  internal_code: 'PUS-VNM-PQC-05-0001',
  title: 'Phu Quoc 3N5D',
  price: 999000,
  airline: 'VJ',
  status: 'pending_review',
  departure_days: 'Wed Thu',
  commission_rate: 9,
  land_operator: '투어폰',
  price_dates: [{ date: '2026-06-10' }, { date: '2026-06-17' }],
  itinerary_data: { days: [{ day: 1 }, { day: 2 }, { day: 3 }] },
};

describe('buildUploadRegisterReport', () => {
  it('points A4 links to the real itinerary print route, not the legacy admin poster path', () => {
    const [row] = buildUploadRegisterReport([pkg]);

    expect(row.mobile_url).toBe('/packages/pkg-123');
    expect(row.lp_url).toBe('/lp/pkg-123');
    expect(row.a4_url).toBe('/itinerary/pkg-123/print?mode=detail');
    expect(row.a4_url).not.toContain('/admin/packages/');
    expect(row.a4_url).not.toContain('/poster');
    expect(row.commission_rate).toBe(9);
    expect(row.land_operator).toBe('투어폰');
    expect(row.price_dates_count).toBe(2);
    expect(row.itinerary_days_count).toBe(3);
  });

  it('normalizes base URLs without producing duplicate slashes', () => {
    const [row] = buildUploadRegisterReport([pkg], 'https://yeosonam.example/');

    expect(row.mobile_url).toBe('https://yeosonam.example/packages/pkg-123');
    expect(row.lp_url).toBe('https://yeosonam.example/lp/pkg-123');
    expect(row.a4_url).toBe('https://yeosonam.example/itinerary/pkg-123/print?mode=detail');
  });

  it('includes saved price row counts supplied by the upload route', () => {
    const [row] = buildUploadRegisterReport([pkg], '', {
      priceRowsByPackageId: new Map([['pkg-123', 99]]),
    });

    expect(row.price_rows_saved).toBe(99);
  });
});
