import { describe, expect, it } from 'vitest';

import type { ScheduleProviderResult } from './schedule-providers';
import { resolveScheduleProviderConsensus } from './schedule-revalidation';
import { buildTransportObservationHash, type TransportFactObservation } from './transport-facts';

function result(
  provider: 'oag' | 'cirium',
  departureLocalTime: string,
  arrivalLocalTime = '22:00',
): ScheduleProviderResult {
  const base: Omit<TransportFactObservation, 'observationHash'> = {
    id: `${provider}-observation`,
    tenantId: 'tenant-1',
    sourceKind: provider,
    sourceFamily: provider,
    carrierCode: 'BX',
    serviceNumber: 'BX321',
    departureAirport: 'PUS',
    arrivalAirport: 'DAD',
    effectiveStart: '2026-10-15',
    effectiveEnd: '2026-10-15',
    operatingWeekdays: [],
    departureLocalTime,
    arrivalLocalTime,
    arrivalDayOffset: 0,
    departureTimezone: 'Asia/Seoul',
    arrivalTimezone: 'Asia/Ho_Chi_Minh',
    observedAt: '2026-08-11T00:00:00Z',
    verifiedAt: '2026-08-11T00:00:00Z',
    sourceWeight: provider === 'oag' ? 0.98 : 0.96,
    sourceHash: 'a'.repeat(64),
    evidence: [],
  };
  return {
    provider,
    status: 'succeeded',
    costKrw: 0,
    observations: [{ ...base, observationHash: buildTransportObservationHash(base) }],
  };
}

describe('schedule revalidation consensus', () => {
  it('accepts one exact OAG and Cirium schedule variant', () => {
    expect(resolveScheduleProviderConsensus([
      result('oag', '19:00'),
      result('cirium', '19:00'),
    ])).toEqual(expect.objectContaining({
      state: 'agreed',
      departureLocalTime: '19:00',
      arrivalLocalTime: '22:00',
    }));
  });

  it('does not average or choose between provider conflicts', () => {
    expect(resolveScheduleProviderConsensus([
      result('oag', '19:00'),
      result('cirium', '20:00'),
    ])).toEqual(expect.objectContaining({
      state: 'conflicting',
      reason: 'PROVIDERS_DO_NOT_AGREE',
    }));
  });

  it('does not treat a single provider as verified', () => {
    expect(resolveScheduleProviderConsensus([result('oag', '19:00')])).toEqual(expect.objectContaining({
      state: 'unavailable',
    }));
  });
});
