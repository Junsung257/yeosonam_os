import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCiriumSchedule, fetchOagSchedule, type ScheduleProviderQuery } from './schedule-providers';

const query: ScheduleProviderQuery = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  carrierCode: 'BX',
  serviceNumber: 'BX321',
  departureAirport: 'PUS',
  arrivalAirport: 'DAD',
  departureDate: '2026-09-19',
  sourceHash: 'a'.repeat(64),
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OAG_SUBSCRIPTION_KEY;
  delete process.env.CIRIUM_APP_ID;
  delete process.env.CIRIUM_APP_KEY;
  delete process.env.OAG_COST_KRW_PER_CALL;
  delete process.env.CIRIUM_COST_KRW_PER_CALL;
});

describe('independent schedule provider adapters', () => {
  it('normalizes an OAG schedule only when route identity matches', async () => {
    process.env.OAG_SUBSCRIPTION_KEY = 'test-key';
    process.env.OAG_COST_KRW_PER_CALL = '10';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{
        carrier: { iata: 'BX' },
        flightNumber: '321',
        departure: { airport: { iata: 'PUS' }, passengerLocalTime: '2026-09-19T19:00:00' },
        arrival: { airport: { iata: 'DAD' }, passengerLocalTime: '2026-09-19T22:10:00' },
        arrivalIntervalDays: 0,
        startDate: '2026-09-01',
        endDate: '2026-10-31',
      }],
    }), { status: 200 })));

    const result = await fetchOagSchedule(query);

    expect(result.status).toBe('succeeded');
    expect(result.costKrw).toBe(10);
    expect(result.observations[0]).toEqual(expect.objectContaining({
      serviceNumber: 'BX321',
      departureAirport: 'PUS',
      arrivalAirport: 'DAD',
      departureLocalTime: '19:00',
      arrivalLocalTime: '22:10',
    }));
  });

  it('normalizes Cirium local times and next-day arrival without copying another route', async () => {
    process.env.CIRIUM_APP_ID = 'test-id';
    process.env.CIRIUM_APP_KEY = 'test-key';
    process.env.CIRIUM_COST_KRW_PER_CALL = '12';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      scheduledFlights: [{
        carrierFsCode: 'BX',
        flightNumber: '321',
        departureAirportFsCode: 'PUS',
        arrivalAirportFsCode: 'DAD',
        departureTime: '2026-09-19T23:50:00.000',
        arrivalTime: '2026-09-20T03:10:00.000',
      }],
    }), { status: 200 })));

    const result = await fetchCiriumSchedule(query);

    expect(result.observations[0]).toEqual(expect.objectContaining({
      departureLocalTime: '23:50',
      arrivalLocalTime: '03:10',
      arrivalDayOffset: 1,
    }));
  });
});
