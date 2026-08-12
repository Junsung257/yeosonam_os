import { describe, expect, it } from 'vitest';

import type { ResolvedTransportForSnapshot } from './shared-fact-orchestrator';
import { applyResolvedTransport, productRegistrationProofScreenshotPath } from './snapshot-publication';

function packageWithFlight() {
  return {
    itinerary_data: {
      flight_segments: [{
        leg: 'outbound',
        flight_no: 'BX134',
        dep_time: '16:30',
        arr_time: '17:35',
        arr_day_offset: 0,
      }],
    },
  };
}

function fact(overrides: Partial<ResolvedTransportForSnapshot> = {}): ResolvedTransportForSnapshot {
  return {
    packageId: 'package-1',
    leg: 'outbound',
    serviceNumber: 'BX134',
    departureAirport: 'PUS',
    arrivalAirport: 'MYJ',
    departureDate: '2026-08-13',
    departureLocalTime: '16:30',
    arrivalLocalTime: '17:35',
    arrivalDayOffset: 0,
    state: 'source_confirmed',
    verifiedByCurrentProviders: false,
    ...overrides,
  };
}

function flight(result: Record<string, unknown>): Record<string, unknown> {
  return ((result.itinerary_data as { flight_segments: Record<string, unknown>[] }).flight_segments[0]);
}

describe('applyResolvedTransport', () => {
  it('hides source times that current schedule providers did not corroborate', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact()]);

    expect(flight(result)).toMatchObject({
      flight_no: 'BX134',
      v6_fact_state: 'degraded',
      v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
    });
    expect(flight(result)).not.toHaveProperty('dep_time');
    expect(flight(result)).not.toHaveProperty('arr_time');
    expect(flight(result)).not.toHaveProperty('arr_day_offset');
  });

  it('uses the single time variant corroborated by current providers', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact({
      state: 'corroborated',
      verifiedByCurrentProviders: true,
      departureLocalTime: '16:45',
      arrivalLocalTime: '17:50',
    })]);

    expect(flight(result)).toMatchObject({
      dep_time: '16:45',
      arr_time: '17:50',
      arr_day_offset: 0,
      v6_fact_state: 'corroborated',
    });
  });

  it('hides times when observations conflict', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [
      fact({ state: 'conflicting' }),
      fact({
        departureDate: '2026-08-14',
        departureLocalTime: '16:45',
        arrivalLocalTime: '17:50',
        state: 'corroborated',
        verifiedByCurrentProviders: true,
      }),
    ]);

    expect(flight(result)).not.toHaveProperty('dep_time');
    expect(flight(result)).not.toHaveProperty('arr_time');
    expect(flight(result)).toMatchObject({ v6_fact_state: 'conflicting' });
  });
});

describe('productRegistrationProofScreenshotPath', () => {
  it('keeps proof screenshots tenant scoped and renderer specific', () => {
    expect(productRegistrationProofScreenshotPath({
      tenantId: 'tenant-1',
      snapshotId: 'snapshot-1',
      rendererBuildId: 'build/one',
      surface: 'packages',
      screenshotHash: 'a'.repeat(64),
    })).toBe(`tenant-1/proofs/snapshot-1/build_one/packages-${'a'.repeat(64)}.png`);
  });
});
