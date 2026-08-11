import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  fetchCiriumSchedule,
  fetchOagSchedule,
  type ScheduleProviderQuery,
  type ScheduleProviderResult,
} from './schedule-providers';
import { buildTransportObservationHash, type TransportFactObservation } from './transport-facts';

type Provider = 'oag' | 'cirium';

type Reservation = {
  action?: 'execute' | 'reuse' | 'wait' | 'exhausted';
  call_id?: string;
  result?: { provider_result?: unknown };
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function providerResult(value: unknown): ScheduleProviderResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.provider !== 'oag' && row.provider !== 'cirium') return null;
  if (row.status !== 'succeeded' && row.status !== 'unavailable' && row.status !== 'failed') return null;
  if (!Array.isArray(row.observations)) return null;
  return {
    provider: row.provider,
    status: row.status,
    observations: row.observations as TransportFactObservation[],
    costKrw: Number(row.costKrw ?? 0),
    error: typeof row.error === 'string' ? row.error : undefined,
  };
}

function rebindObservation(
  observation: TransportFactObservation,
  query: ScheduleProviderQuery,
): TransportFactObservation {
  const { observationHash: _previousHash, ...previous } = observation;
  const rebound = {
    ...previous,
    tenantId: query.tenantId,
    productRevisionId: query.productRevisionId ?? null,
    packageId: query.packageId ?? null,
    sourceHash: query.sourceHash,
  };
  return { ...rebound, observationHash: buildTransportObservationHash(rebound) };
}

export async function executeScheduleProviderEffectivelyOnce(input: {
  supabase: SupabaseClient;
  tenantId: string;
  jobId: string | null;
  revisionId: string;
  revisionHash: string;
  sourceHash: string;
  provider: Provider;
  /**
   * Stable inside one retryable effect, different for a later freshness
   * checkpoint. This prevents D-90 results from being reused at D-30/D-7.
   */
  operationScope: string;
  query: ScheduleProviderQuery;
}): Promise<{ result: ScheduleProviderResult; chargedCostKrw: number; reused: boolean }> {
  const requestContract = {
    version: 'schedule-provider-request-2',
    provider: input.provider,
    carrierCode: input.query.carrierCode,
    serviceNumber: input.query.serviceNumber,
    departureAirport: input.query.departureAirport,
    arrivalAirport: input.query.arrivalAirport,
    departureDate: input.query.departureDate,
  };
  const requestHash = hash(requestContract);
  const scope = input.operationScope.trim();
  if (!scope) throw new Error('V6_PROVIDER_OPERATION_SCOPE_REQUIRED');
  const operationKey = `schedule:v2:${requestHash}:${input.provider}:${hash({ scope })}`;
  const { data, error } = await input.supabase.rpc('reserve_product_registration_v6_provider_call', {
    p_payload: {
      tenant_id: input.tenantId,
      job_id: input.jobId,
      product_revision_id: input.revisionId,
      provider: input.provider,
      operation: 'schedule_lookup',
      operation_key: operationKey,
      request_hash: requestHash,
      source_hash: input.sourceHash,
      revision_hash: input.revisionHash,
      created_version: 'product-registration-v6-provider-2',
    },
  });
  if (error) throw error;
  const reservation = (data ?? {}) as Reservation;

  if (reservation.action === 'wait') throw new Error('V6_PROVIDER_CALL_IN_FLIGHT');
  if (reservation.action === 'exhausted') {
    return {
      result: {
        provider: input.provider,
        status: 'failed',
        observations: [],
        costKrw: 0,
        error: 'V6_PROVIDER_RETRY_EXHAUSTED',
      },
      chargedCostKrw: 0,
      reused: true,
    };
  }
  if (reservation.action === 'reuse') {
    const stored = providerResult(reservation.result?.provider_result);
    if (!stored || stored.provider !== input.provider) throw new Error('V6_PROVIDER_REUSABLE_RESULT_INVALID');
    return {
      result: {
        ...stored,
        observations: stored.observations.map(observation => rebindObservation(observation, input.query)),
        costKrw: 0,
      },
      chargedCostKrw: 0,
      reused: true,
    };
  }
  if (reservation.action !== 'execute' || !reservation.call_id) {
    throw new Error('V6_PROVIDER_RESERVATION_RESPONSE_INVALID');
  }

  const result = input.provider === 'oag'
    ? await fetchOagSchedule(input.query)
    : await fetchCiriumSchedule(input.query);
  const storedResult = { provider_result: result };
  const responseHash = hash(storedResult);
  const status = result.status === 'succeeded'
    ? 'succeeded'
    : result.status === 'unavailable'
      ? 'skipped'
      : 'failed';
  const { error: completionError } = await input.supabase.rpc(
    'complete_product_registration_v6_provider_call',
    {
      p_payload: {
        call_id: reservation.call_id,
        request_hash: requestHash,
        response_hash: responseHash,
        status,
        billed_units: result.status === 'unavailable' ? 0 : 1,
        cost_krw: result.costKrw,
        result: storedResult,
      },
    },
  );
  if (completionError) throw completionError;
  return { result, chargedCostKrw: result.costKrw, reused: false };
}
