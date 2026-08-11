import type { SupabaseClient } from '@supabase/supabase-js';

import { loadProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';
import { estimatedScheduleProviderCostKrw, type ScheduleProviderResult } from './schedule-providers';
import { executeScheduleProviderEffectivelyOnce } from './provider-call-ledger';
import { recordTransportObservation } from './transport-facts';

type JsonObject = Record<string, unknown>;

type ScheduleRevalidationJob = {
  id: string;
  tenant_id: string;
  catalog_product_id: string;
  product_revision_id: string;
  departure_date: string;
  checkpoint: string;
  provider_policy_version: string;
  attempt_count: number;
};

export type ScheduleConsensus = {
  state: 'agreed' | 'unavailable' | 'conflicting';
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
  observationIds: string[];
  reason?: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function time(value: unknown): string | null {
  const match = text(value)?.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

export function resolveScheduleProviderConsensus(results: ScheduleProviderResult[]): ScheduleConsensus {
  const successful = results.filter(result => result.status === 'succeeded');
  const groups = new Map<string, { providers: Set<string>; ids: string[] }>();
  for (const result of successful) {
    for (const observation of result.observations) {
      const departure = time(observation.departureLocalTime);
      const arrival = time(observation.arrivalLocalTime);
      if (!departure || !arrival) continue;
      const key = `${departure}|${arrival}|${observation.arrivalDayOffset}`;
      const group = groups.get(key) ?? { providers: new Set<string>(), ids: [] };
      group.providers.add(result.provider);
      if (observation.id) group.ids.push(observation.id);
      groups.set(key, group);
    }
  }
  const agreed = [...groups.entries()].filter(([, group]) => group.providers.has('oag') && group.providers.has('cirium'));
  if (agreed.length === 0) {
    return {
      state: successful.length === 2 ? 'conflicting' : 'unavailable',
      departureLocalTime: null,
      arrivalLocalTime: null,
      arrivalDayOffset: 0,
      observationIds: [],
      reason: successful.length === 2 ? 'PROVIDERS_DO_NOT_AGREE' : 'INDEPENDENT_PROVIDERS_UNAVAILABLE',
    };
  }
  if (agreed.length > 1) {
    return {
      state: 'conflicting',
      departureLocalTime: null,
      arrivalLocalTime: null,
      arrivalDayOffset: 0,
      observationIds: agreed.flatMap(([, group]) => group.ids),
      reason: 'MULTIPLE_PROVIDER_SCHEDULE_VARIANTS',
    };
  }
  const [key, group] = agreed[0]!;
  const [departureLocalTime, arrivalLocalTime, dayOffset] = key.split('|');
  return {
    state: 'agreed',
    departureLocalTime: departureLocalTime!,
    arrivalLocalTime: arrivalLocalTime!,
    arrivalDayOffset: Number(dayOffset),
    observationIds: group.ids,
  };
}

async function disabledProviders(supabase: SupabaseClient): Promise<Array<'oag' | 'cirium'>> {
  const { data, error } = await supabase
    .from('product_registration_v5_kill_switches')
    .select('scope_key')
    .eq('scope', 'transport_provider')
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) throw error;
  const keys = new Set((data ?? []).map(row => String(row.scope_key).toLowerCase()));
  return (['oag', 'cirium'] as const).filter(provider => keys.has('*') || keys.has(provider));
}

async function complete(input: {
  supabase: SupabaseClient;
  jobId: string;
  status: 'unchanged' | 'blocked' | 'failed';
  result: JsonObject;
  lastError?: string | null;
}) {
  const { error } = await input.supabase.rpc('complete_product_registration_schedule_revalidation', {
    p_payload: {
      job_id: input.jobId,
      status: input.status,
      result: input.result,
      last_error: input.lastError ?? null,
    },
  });
  if (error) throw error;
}

async function processJob(input: {
  supabase: SupabaseClient;
  job: ScheduleRevalidationJob;
  disabled: Array<'oag' | 'cirium'>;
}): Promise<'unchanged' | 'blocked' | 'failed'> {
  try {
    const aggregate = await loadProductRegistrationRevisionAggregate({
      supabase: input.supabase,
      revisionId: input.job.product_revision_id,
    });
    if (aggregate.revision.tenant_id !== input.job.tenant_id
      || aggregate.revision.catalog_product_id !== input.job.catalog_product_id) {
      throw new Error('SCHEDULE_REVALIDATION_REVISION_LINEAGE_MISMATCH');
    }
    const flights = aggregate.transportSegments.filter(segment => segment.transport_type === 'flight');
    if (flights.length === 0) {
      await complete({
        supabase: input.supabase,
        jobId: input.job.id,
        status: 'unchanged',
        result: { checkpoint: input.job.checkpoint, reason: 'NO_FLIGHT_SEGMENTS' },
      });
      return 'unchanged';
    }

    let remainingBudgetKrw = 2_000;
    const drifts: JsonObject[] = [];
    const verificationErrors: string[] = [];
    for (const [index, segment] of flights.entries()) {
      const serviceNumber = text(segment.service_number)?.replace(/\s+/g, '').toUpperCase();
      const departureAirport = text(segment.departure_place_code)?.toUpperCase();
      const arrivalAirport = text(segment.arrival_place_code)?.toUpperCase();
      if (!serviceNumber || !departureAirport || !arrivalAirport) {
        verificationErrors.push(`segment:${index}:FLIGHT_IDENTITY_INCOMPLETE`);
        continue;
      }
      const query = {
        tenantId: input.job.tenant_id,
        carrierCode: text(segment.carrier_code) ?? serviceNumber.match(/^([A-Z0-9]{2,3})/)?.[1] ?? '',
        serviceNumber,
        departureAirport,
        arrivalAirport,
        departureDate: input.job.departure_date,
        sourceHash: aggregate.revision.source_hash,
        productRevisionId: input.job.product_revision_id,
        packageId: text(segment.package_id),
      };
      const activeProviders = (['oag', 'cirium'] as const)
        .filter(providerName => !input.disabled.includes(providerName));
      const estimatedCostKrw = activeProviders.reduce(
        (sum, providerName) => sum + estimatedScheduleProviderCostKrw(providerName),
        0,
      );
      if (estimatedCostKrw > remainingBudgetKrw) {
        verificationErrors.push(`segment:${index}:DOCUMENT_EXTERNAL_COST_LIMIT_REACHED`);
        continue;
      }
      const providerResults: ScheduleProviderResult[] = [];
      for (const providerName of activeProviders) {
        const execution = await executeScheduleProviderEffectivelyOnce({
          supabase: input.supabase,
          tenantId: input.job.tenant_id,
          jobId: null,
          revisionId: input.job.product_revision_id,
          revisionHash: aggregate.revision.payload_hash,
          sourceHash: aggregate.revision.source_hash,
          provider: providerName,
          operationScope: `revalidation:${input.job.id}:${input.job.checkpoint}:segment:${index}`,
          query,
        });
        providerResults.push(execution.result);
        remainingBudgetKrw -= execution.chargedCostKrw;
      }
      for (const providerName of input.disabled) {
        providerResults.push({
          provider: providerName,
          status: 'unavailable',
          observations: [],
          costKrw: 0,
          error: `${providerName.toUpperCase()}_KILL_SWITCH_ACTIVE`,
        });
      }
      const providerObservations = providerResults.flatMap(result => result.observations);
      for (const observation of providerObservations) {
        observation.revisionHash = aggregate.revision.payload_hash;
        observation.id = await recordTransportObservation({ supabase: input.supabase, observation });
      }
      const consensus = resolveScheduleProviderConsensus(providerResults.map(result => ({
        ...result,
        observations: result.observations.map(observation => ({
          ...observation,
          id: providerObservations.find(item => item.observationHash === observation.observationHash)?.id ?? observation.id,
        })),
      })));
      if (consensus.state !== 'agreed') {
        verificationErrors.push(`segment:${index}:${consensus.reason ?? consensus.state}`);
        continue;
      }
      const sourceDeparture = time(segment.departure_local_time);
      const sourceArrival = time(segment.arrival_local_time);
      const sourceDayOffset = Number(segment.arrival_day_offset ?? 0);
      if (sourceDeparture && sourceArrival && (
        sourceDeparture !== consensus.departureLocalTime
        || sourceArrival !== consensus.arrivalLocalTime
        || sourceDayOffset !== consensus.arrivalDayOffset
      )) {
        drifts.push({
          segmentIndex: index,
          serviceNumber,
          departureAirport,
          arrivalAirport,
          departureDate: input.job.departure_date,
          source: { departureLocalTime: sourceDeparture, arrivalLocalTime: sourceArrival, arrivalDayOffset: sourceDayOffset },
          verifiedSchedule: consensus,
        });
      }
    }

    if (drifts.length > 0) {
      const { error: overlayError } = await input.supabase.rpc('set_product_registration_availability_overlay', {
        p_payload: {
          tenant_id: input.job.tenant_id,
          catalog_product_id: input.job.catalog_product_id,
          channel: 'customer',
          sale_state: 'suspended',
          reason: `FLIGHT_SCHEDULE_DRIFT:${input.job.id}`,
        },
      });
      if (overlayError) throw overlayError;
      await complete({
        supabase: input.supabase,
        jobId: input.job.id,
        status: 'blocked',
        result: { checkpoint: input.job.checkpoint, drifts, correctionRequired: true },
      });
      return 'blocked';
    }
    if (verificationErrors.length > 0) {
      await complete({
        supabase: input.supabase,
        jobId: input.job.id,
        status: 'failed',
        result: { checkpoint: input.job.checkpoint, verificationErrors },
        lastError: verificationErrors.join('|'),
      });
      return 'failed';
    }
    await complete({
      supabase: input.supabase,
      jobId: input.job.id,
      status: 'unchanged',
      result: { checkpoint: input.job.checkpoint, verifiedSegments: flights.length },
    });
    return 'unchanged';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await complete({
      supabase: input.supabase,
      jobId: input.job.id,
      status: 'failed',
      result: { checkpoint: input.job.checkpoint },
      lastError: message,
    });
    return 'failed';
  }
}

export async function processProductRegistrationScheduleRevalidations(input: {
  supabase: SupabaseClient;
  workerId: string;
  limit?: number;
}) {
  const { data, error } = await input.supabase.rpc('claim_product_registration_schedule_revalidations', {
    p_limit: Math.max(1, Math.min(input.limit ?? 10, 50)),
    p_worker_id: input.workerId,
  });
  if (error) throw error;
  const jobs = Array.isArray(data) ? data as ScheduleRevalidationJob[] : [];
  const disabled = await disabledProviders(input.supabase);
  const outcomes = { claimed: jobs.length, unchanged: 0, blocked: 0, failed: 0 };
  for (const job of jobs) {
    const outcome = await processJob({ supabase: input.supabase, job, disabled });
    outcomes[outcome] += 1;
  }
  return outcomes;
}
