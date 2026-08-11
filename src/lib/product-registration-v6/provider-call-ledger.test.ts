import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { executeScheduleProviderEffectivelyOnce } from './provider-call-ledger';
import { buildTransportObservationHash, type TransportFactObservation } from './transport-facts';

const fetchOagSchedule = vi.hoisted(() => vi.fn());
const fetchCiriumSchedule = vi.hoisted(() => vi.fn());

vi.mock('./schedule-providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('./schedule-providers')>();
  return { ...original, fetchOagSchedule, fetchCiriumSchedule };
});

function observation(overrides: Partial<TransportFactObservation> = {}): TransportFactObservation {
  const withoutHash: Omit<TransportFactObservation, 'observationHash'> = {
    tenantId: 'tenant-old',
    productRevisionId: 'revision-old',
    packageId: null,
    sourceKind: 'oag',
    sourceFamily: 'oag',
    carrierCode: 'BX',
    serviceNumber: 'BX321',
    departureAirport: 'PUS',
    arrivalAirport: 'DAD',
    effectiveStart: '2026-10-15',
    effectiveEnd: '2026-10-15',
    operatingWeekdays: [],
    departureLocalTime: '19:00',
    arrivalLocalTime: '22:00',
    arrivalDayOffset: 0,
    departureTimezone: 'Asia/Seoul',
    arrivalTimezone: 'Asia/Ho_Chi_Minh',
    observedAt: '2026-08-11T00:00:00.000Z',
    sourceWeight: 0.98,
    sourceHash: 'a'.repeat(64),
    revisionHash: 'b'.repeat(64),
    evidence: [],
    ...overrides,
  };
  return { ...withoutHash, observationHash: buildTransportObservationHash(withoutHash) };
}

const query = {
  tenantId: 'tenant-new',
  carrierCode: 'BX',
  serviceNumber: 'BX321',
  departureAirport: 'PUS',
  arrivalAirport: 'DAD',
  departureDate: '2026-10-15',
  sourceHash: 'c'.repeat(64),
  productRevisionId: 'revision-new',
  packageId: null,
};

describe('provider call ledger', () => {
  beforeEach(() => {
    fetchOagSchedule.mockReset();
    fetchCiriumSchedule.mockReset();
  });

  it('reuses a completed provider call without another external request and rebinds lineage', async () => {
    const stored = {
      provider: 'oag' as const,
      status: 'succeeded' as const,
      observations: [observation()],
      costKrw: 120,
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { action: 'reuse', call_id: 'call-1', result: { provider_result: stored } },
      error: null,
    });
    const result = await executeScheduleProviderEffectivelyOnce({
      supabase: { rpc } as unknown as SupabaseClient,
      tenantId: 'tenant-new',
      jobId: 'job-new',
      revisionId: 'revision-new',
      revisionHash: 'd'.repeat(64),
      sourceHash: query.sourceHash,
      provider: 'oag',
      operationScope: 'registration:job-new:revision-new',
      query,
    });

    expect(fetchOagSchedule).not.toHaveBeenCalled();
    expect(result.reused).toBe(true);
    expect(result.chargedCostKrw).toBe(0);
    expect(result.result.observations[0]).toMatchObject({
      tenantId: 'tenant-new',
      productRevisionId: 'revision-new',
      sourceHash: query.sourceHash,
    });
  });

  it('completes a reservation after exactly one external request', async () => {
    const external = {
      provider: 'oag' as const,
      status: 'succeeded' as const,
      observations: [observation({ tenantId: 'tenant-new', productRevisionId: 'revision-new' })],
      costKrw: 120,
    };
    fetchOagSchedule.mockResolvedValue(external);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { action: 'execute', call_id: 'call-2' }, error: null })
      .mockResolvedValueOnce({ data: { call_id: 'call-2', completed: true }, error: null });

    const result = await executeScheduleProviderEffectivelyOnce({
      supabase: { rpc } as unknown as SupabaseClient,
      tenantId: 'tenant-new',
      jobId: 'job-new',
      revisionId: 'revision-new',
      revisionHash: 'd'.repeat(64),
      sourceHash: query.sourceHash,
      provider: 'oag',
      operationScope: 'registration:job-new:revision-new',
      query,
    });

    expect(fetchOagSchedule).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      'reserve_product_registration_v6_provider_call',
      'complete_product_registration_v6_provider_call',
    ]);
    expect(result.chargedCostKrw).toBe(120);
    expect(result.reused).toBe(false);
  });

  it('uses a different operation key for a later schedule freshness checkpoint', async () => {
    const external = {
      provider: 'oag' as const,
      status: 'succeeded' as const,
      observations: [observation({ tenantId: 'tenant-new', productRevisionId: 'revision-new' })],
      costKrw: 120,
    };
    fetchOagSchedule.mockResolvedValue(external);
    const operationKeys: string[] = [];
    const rpc = vi.fn().mockImplementation((name: string, args: { p_payload?: { operation_key?: string } }) => {
      if (name === 'reserve_product_registration_v6_provider_call') {
        operationKeys.push(String(args.p_payload?.operation_key));
        return Promise.resolve({ data: { action: 'execute', call_id: `call-${operationKeys.length}` }, error: null });
      }
      return Promise.resolve({ data: { completed: true }, error: null });
    });
    const base = {
      supabase: { rpc } as unknown as SupabaseClient,
      tenantId: 'tenant-new',
      jobId: null,
      revisionId: 'revision-new',
      revisionHash: 'd'.repeat(64),
      sourceHash: query.sourceHash,
      provider: 'oag' as const,
      query,
    };

    await executeScheduleProviderEffectivelyOnce({ ...base, operationScope: 'revalidation:flight-1:d90' });
    await executeScheduleProviderEffectivelyOnce({ ...base, operationScope: 'revalidation:flight-1:d30' });

    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[0]).not.toBe(operationKeys[1]);
    expect(fetchOagSchedule).toHaveBeenCalledTimes(2);
  });
});
