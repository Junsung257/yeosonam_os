import { describe, expect, it } from 'vitest';

import {
  catalogProductsEligibleForScheduleDriftClear,
  type ResolvedTransportForSnapshot,
  type SharedFactJobResult,
} from './shared-fact-orchestrator';

function transport(overrides: Partial<ResolvedTransportForSnapshot> = {}): ResolvedTransportForSnapshot {
  return {
    packageId: 'package-a',
    leg: 'outbound',
    serviceNumber: 'BX321',
    departureAirport: 'PUS',
    arrivalAirport: 'DAD',
    departureDate: '2026-10-15',
    departureLocalTime: '19:00',
    arrivalLocalTime: '22:00',
    arrivalDayOffset: 0,
    state: 'source_confirmed',
    verifiedByCurrentProviders: true,
    ...overrides,
  };
}

function shared(overrides: Partial<SharedFactJobResult> = {}): SharedFactJobResult {
  return {
    blockers: [],
    degradedReasons: [],
    resolvedTransport: [transport()],
    totalExternalCostKrw: 0,
    ...overrides,
  };
}

describe('schedule drift overlay recovery eligibility', () => {
  it('allows clearing only after every flight is verified by both current providers', () => {
    expect(catalogProductsEligibleForScheduleDriftClear({
      packageIds: ['package-a'],
      catalogProductIds: ['catalog-a'],
      shared: shared(),
    })).toEqual(['catalog-a']);
  });

  it('does not clear when a transport is source-only or a package blocker exists', () => {
    expect(catalogProductsEligibleForScheduleDriftClear({
      packageIds: ['package-a'],
      catalogProductIds: ['catalog-a'],
      shared: shared({ resolvedTransport: [transport({ verifiedByCurrentProviders: false })] }),
    })).toEqual([]);
    expect(catalogProductsEligibleForScheduleDriftClear({
      packageIds: ['package-a'],
      catalogProductIds: ['catalog-a'],
      shared: shared({ blockers: ['package:package-a:segment:0:FLIGHT_SOURCE_PROVIDER_TIME_CONFLICT'] }),
    })).toEqual([]);
  });

  it('does not clear a non-flight product or mismatched identity', () => {
    expect(catalogProductsEligibleForScheduleDriftClear({
      packageIds: ['package-a'],
      catalogProductIds: [],
      shared: shared({ resolvedTransport: [] }),
    })).toEqual([]);
  });
});
