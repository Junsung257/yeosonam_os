import { describe, expect, it } from 'vitest';

import {
  TRANSPORT_SOURCE_WEIGHTS,
  buildTransportObservationHash,
  resolveTransportFact,
  type TransportFactObservation,
} from './transport-facts';

function observation(overrides: Partial<TransportFactObservation> = {}): TransportFactObservation {
  const base: Omit<TransportFactObservation, 'observationHash'> = {
    id: 'obs-1',
    tenantId: null,
    sourceKind: 'oag',
    sourceFamily: 'oag',
    carrierCode: 'BX',
    serviceNumber: 'BX321',
    departureAirport: 'PUS',
    arrivalAirport: 'DAD',
    effectiveStart: '2026-10-01',
    effectiveEnd: '2026-10-31',
    operatingWeekdays: [],
    departureLocalTime: '19:00',
    arrivalLocalTime: '22:00',
    arrivalDayOffset: 0,
    departureTimezone: 'Asia/Seoul',
    arrivalTimezone: 'Asia/Ho_Chi_Minh',
    observedAt: '2026-08-11T00:00:00Z',
    sourceWeight: TRANSPORT_SOURCE_WEIGHTS.oag,
    sourceHash: 'a'.repeat(64),
    evidence: [],
  };
  const merged = { ...base, ...overrides };
  return { ...merged, observationHash: buildTransportObservationHash(merged) };
}

const missingTimes = {
  carrierCode: 'BX',
  serviceNumber: 'BX321',
  departureAirport: 'PUS',
  arrivalAirport: 'DAD',
  departureDate: '2026-10-15',
  departureLocalTime: null,
  arrivalLocalTime: null,
  arrivalDayOffset: 0,
};

describe('shared transport fact resolver', () => {
  it('never overwrites explicit source times', () => {
    const result = resolveTransportFact({
      source: { ...missingTimes, departureLocalTime: '20:00', arrivalLocalTime: '23:00' },
      observations: [observation()],
    });
    expect(result.state).toBe('source_confirmed');
    expect(result.fact.departureLocalTime).toBe('20:00');
    expect(result.verifiedByCurrentProviders).toBe(false);
  });

  it('blocks explicit source times when OAG and Cirium agree on a different current schedule', () => {
    const result = resolveTransportFact({
      source: { ...missingTimes, departureLocalTime: '20:00', arrivalLocalTime: '23:00' },
      observations: [
        observation({ id: 'oag-current' }),
        observation({ id: 'cirium-current', sourceKind: 'cirium', sourceFamily: 'cirium', sourceWeight: TRANSPORT_SOURCE_WEIGHTS.cirium }),
      ],
    });
    expect(result.state).toBe('conflicting');
    expect(result.fact.departureLocalTime).toBe('20:00');
    expect(result.blockers).toContain('FLIGHT_SOURCE_PROVIDER_TIME_CONFLICT');
    expect(result.verifiedByCurrentProviders).toBe(false);
  });

  it('fills missing times only when independent high-confidence sources agree', () => {
    const result = resolveTransportFact({
      source: missingTimes,
      observations: [
        observation(),
        observation({ id: 'obs-2', sourceKind: 'cirium', sourceFamily: 'cirium', sourceWeight: TRANSPORT_SOURCE_WEIGHTS.cirium }),
      ],
    });
    expect(result.state).toBe('corroborated');
    expect(result.fact.departureLocalTime).toBe('19:00');
    expect(result.verifiedByCurrentProviders).toBe(true);
  });

  it('marks explicit source times verified only when OAG and Cirium agree', () => {
    const result = resolveTransportFact({
      source: { ...missingTimes, departureLocalTime: '19:00', arrivalLocalTime: '22:00' },
      observations: [
        observation({ id: 'oag-current' }),
        observation({
          id: 'cirium-current',
          sourceKind: 'cirium',
          sourceFamily: 'cirium',
          sourceWeight: TRANSPORT_SOURCE_WEIGHTS.cirium,
        }),
      ],
    });
    expect(result.state).toBe('source_confirmed');
    expect(result.verifiedByCurrentProviders).toBe(true);
  });

  it('does not copy a single historical product time', () => {
    const result = resolveTransportFact({
      source: missingTimes,
      observations: [observation({ sourceKind: 'verified_product', sourceFamily: 'product-1', sourceWeight: 0.8 })],
    });
    expect(result.state).toBe('degraded');
    expect(result.fact.departureLocalTime).toBeNull();
  });

  it('preserves conflicting schedule variants instead of averaging', () => {
    const result = resolveTransportFact({
      source: missingTimes,
      observations: [
        observation({ id: 'oag-a' }),
        observation({ id: 'cirium-a', sourceKind: 'cirium', sourceFamily: 'cirium', sourceWeight: 0.96 }),
        observation({ id: 'oag-b', departureLocalTime: '20:00' }),
        observation({ id: 'cirium-b', sourceKind: 'cirium', sourceFamily: 'cirium', sourceWeight: 0.96, departureLocalTime: '20:00' }),
      ],
    });
    expect(result.state).toBe('conflicting');
    expect(result.fact.departureLocalTime).toBeNull();
  });

  it('detects shifted or invalid airport fields', () => {
    const result = resolveTransportFact({
      source: { ...missingTimes, departureAirport: 'BX321', serviceNumber: 'PUS' },
      observations: [],
    });
    expect(result.state).toBe('conflicting');
    expect(result.blockers).toContain('FLIGHT_ROUTE_INVALID_OR_FIELD_SHIFTED');
  });

  it('does not mix seasonal observations outside the departure date', () => {
    const result = resolveTransportFact({
      source: missingTimes,
      observations: [
        observation({ effectiveStart: '2026-11-01', effectiveEnd: '2026-11-30' }),
        observation({ sourceKind: 'cirium', sourceFamily: 'cirium', sourceWeight: 0.96, effectiveStart: '2026-11-01', effectiveEnd: '2026-11-30' }),
      ],
    });
    expect(result.state).toBe('degraded');
    expect(result.fact.departureLocalTime).toBeNull();
  });
});
