import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadProductRegistrationRevisionAggregate } from '@/lib/product-registration-authority/revision-aggregate';
import { ensureLicensedReferenceMedia } from './media-provenance';
import { estimatedScheduleProviderCostKrw } from './schedule-providers';
import { executeScheduleProviderEffectivelyOnce } from './provider-call-ledger';
import {
  TRANSPORT_SOURCE_WEIGHTS,
  buildTransportObservationHash,
  listTransportObservations,
  recordTransportObservation,
  resolveTransportFact,
  type SourceTransportFact,
  type TransportFactObservation,
} from './transport-facts';

type JsonObject = Record<string, unknown>;

export type ResolvedTransportForSnapshot = {
  packageId: string | null;
  leg: string;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
  state: 'source_confirmed' | 'corroborated' | 'degraded' | 'conflicting';
  verifiedByCurrentProviders: boolean;
};

export type SharedFactJobResult = {
  blockers: string[];
  degradedReasons: string[];
  resolvedTransport: ResolvedTransportForSnapshot[];
  totalExternalCostKrw: number;
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function departureDates(rows: JsonObject[]): string[] {
  return [...new Set(rows.map(row => string(row.departure_date)).filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date))))]
    .sort()
    .slice(0, 10);
}

function normalizeAirport(value: unknown): string | null {
  const text = string(value)?.toUpperCase() ?? null;
  if (!text) return null;
  const match = text.match(/\b[A-Z]{3}\b/);
  return match?.[0] ?? text;
}

function observationFromSource(input: {
  tenantId: string | null;
  sourceDocumentId: string;
  revisionId: string;
  revisionHash: string;
  packageId: string | null;
  sourceHash: string;
  segment: JsonObject;
  date: string;
}): TransportFactObservation | null {
  const serviceNumber = string(input.segment.service_number ?? input.segment.flight_no ?? input.segment.code)?.replace(/\s+/g, '').toUpperCase();
  const departureAirport = normalizeAirport(input.segment.departure_place_code ?? input.segment.dep_airport ?? input.segment.departure_airport);
  const arrivalAirport = normalizeAirport(input.segment.arrival_place_code ?? input.segment.arr_airport ?? input.segment.arrival_airport);
  if (!serviceNumber || !departureAirport || !arrivalAirport) return null;
  const carrierCode = serviceNumber.match(/^([A-Z0-9]{2,3})/)?.[1] ?? null;
  const withoutHash: Omit<TransportFactObservation, 'observationHash'> = {
    tenantId: input.tenantId,
    sourceDocumentId: input.sourceDocumentId,
    productRevisionId: input.revisionId,
    packageId: input.packageId,
    sourceKind: 'current_source',
    sourceFamily: `source:${input.sourceDocumentId}`,
    carrierCode,
    serviceNumber,
    departureAirport,
    arrivalAirport,
    effectiveStart: input.date,
    effectiveEnd: input.date,
    operatingWeekdays: [],
    departureLocalTime: string(input.segment.departure_local_time ?? input.segment.dep_time),
    arrivalLocalTime: string(input.segment.arrival_local_time ?? input.segment.arr_time),
    arrivalDayOffset: Number(input.segment.arrival_day_offset ?? input.segment.arr_day_offset ?? 0),
    departureTimezone: string(input.segment.departure_timezone),
    arrivalTimezone: string(input.segment.arrival_timezone),
    observedAt: new Date().toISOString(),
    sourceWeight: TRANSPORT_SOURCE_WEIGHTS.current_source,
    sourceHash: input.sourceHash,
    revisionHash: input.revisionHash,
    evidence: [{ source_document_id: input.sourceDocumentId, segment: input.segment }],
  };
  return { ...withoutHash, observationHash: buildTransportObservationHash(withoutHash) };
}

function resolutionHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedLeg(value: unknown): 'outbound' | 'inbound' | 'intermediate' {
  const leg = string(value)?.toLowerCase();
  return leg === 'outbound' || leg === 'inbound' ? leg : 'intermediate';
}

async function disabledTransportProviders(supabase: SupabaseClient): Promise<Array<'oag' | 'cirium'>> {
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

export async function resolveSharedFactsForJob(input: {
  supabase: SupabaseClient;
  jobId: string;
  packageIds: string[];
  revisionIds: string[];
  sourceDocumentId: string;
  sourceHash: string;
  tenantId: string | null;
}): Promise<SharedFactJobResult> {
  const result: SharedFactJobResult = { blockers: [], degradedReasons: [], resolvedTransport: [], totalExternalCostKrw: 0 };
  const disabledProviders = await disabledTransportProviders(input.supabase);
  const { data: jobCost, error: jobCostError } = await input.supabase
    .from('upload_jobs')
    .select('v6_external_cost_krw')
    .eq('id', input.jobId)
    .single();
  if (jobCostError) throw jobCostError;
  const existingExternalCostKrw = Number(jobCost?.v6_external_cost_krw ?? 0);
  for (const [packageIndex, packageId] of input.packageIds.entries()) {
    const revisionId = input.revisionIds[packageIndex] ?? input.revisionIds[0];
    if (!revisionId) {
      result.blockers.push(`package:${packageId}:CANONICAL_REVISION_MISSING`);
      continue;
    }
    let aggregate = await loadProductRegistrationRevisionAggregate({
      supabase: input.supabase,
      revisionId,
    }).catch(() => null);
    if (!aggregate?.revision.payload_hash) {
      result.blockers.push(`package:${packageId}:CANONICAL_REVISION_HASH_MISSING`);
      continue;
    }
    if (input.tenantId && aggregate.revision.tenant_id !== input.tenantId) {
      result.blockers.push(`package:${packageId}:REVISION_TENANT_MISMATCH`);
      continue;
    }
    if (aggregate.media.length === 0) {
      const media = await ensureLicensedReferenceMedia({
        supabase: input.supabase,
        aggregate,
      });
      if (media.linked) {
        aggregate = await loadProductRegistrationRevisionAggregate({
          supabase: input.supabase,
          revisionId,
        });
      } else {
        result.degradedReasons.push(`package:${packageId}:${media.reason}`);
      }
    }
    const revisionHash = aggregate.revision.payload_hash;
    const segments = aggregate.transportSegments.filter(segment => segment.transport_type === 'flight');
    const dates = departureDates(aggregate.departures);
    if (segments.length === 0) continue;
    if (dates.length === 0) {
      result.blockers.push(`package:${packageId}:DEPARTURE_DATE_MISSING_FOR_TRANSPORT`);
      continue;
    }

    for (const [segmentIndex, segment] of segments.entries()) {
      for (const date of dates) {
        const currentObservation = observationFromSource({
          tenantId: input.tenantId,
          sourceDocumentId: input.sourceDocumentId,
          revisionId,
          revisionHash,
          // Compatibility rows do not exist until the canonical revision has
          // passed validation. The revision/catalog lineage is authoritative;
          // package_id is attached later by the projection RPC.
          packageId: null,
          sourceHash: input.sourceHash,
          segment,
          date,
        });
        if (!currentObservation) {
          result.blockers.push(`package:${packageId}:segment:${segmentIndex}:FLIGHT_IDENTITY_OR_ROUTE_MISSING`);
          continue;
        }
        await recordTransportObservation({ supabase: input.supabase, observation: currentObservation });
        const observations = await listTransportObservations({
          supabase: input.supabase,
          tenantId: input.tenantId,
          serviceNumber: currentObservation.serviceNumber,
          departureAirport: currentObservation.departureAirport,
          arrivalAirport: currentObservation.arrivalAirport,
          departureDate: date,
        });
        const source: SourceTransportFact = {
          carrierCode: currentObservation.carrierCode,
          serviceNumber: currentObservation.serviceNumber,
          departureAirport: currentObservation.departureAirport,
          arrivalAirport: currentObservation.arrivalAirport,
          departureDate: date,
          departureLocalTime: currentObservation.departureLocalTime,
          arrivalLocalTime: currentObservation.arrivalLocalTime,
          arrivalDayOffset: currentObservation.arrivalDayOffset,
        };
        const providerFamilies = new Set(observations
          .filter(item => item.sourceKind === 'oag' || item.sourceKind === 'cirium')
          .map(item => item.sourceKind));
        // Future schedules are checked even when the supplier source includes
        // times. Explicit source facts are never overwritten; a two-provider
        // disagreement becomes a blocker in resolveTransportFact().
        if (!(providerFamilies.has('oag') && providerFamilies.has('cirium'))) {
          if (!input.tenantId) throw new Error('V6_PROVIDER_TENANT_REQUIRED');
          const query = {
            tenantId: input.tenantId,
            carrierCode: currentObservation.carrierCode ?? '',
            serviceNumber: currentObservation.serviceNumber,
            departureAirport: currentObservation.departureAirport,
            arrivalAirport: currentObservation.arrivalAirport,
            departureDate: date,
            sourceHash: input.sourceHash,
            productRevisionId: revisionId,
            packageId: null,
          };
          const activeProviders = (['oag', 'cirium'] as const)
            .filter(provider => !disabledProviders.includes(provider));
          const estimatedCostKrw = activeProviders.reduce(
            (sum, provider) => sum + estimatedScheduleProviderCostKrw(provider),
            0,
          );
          const remainingBudgetKrw = Math.max(
            0,
            2_000 - existingExternalCostKrw - result.totalExternalCostKrw,
          );
          const providerObservations: TransportFactObservation[] = [];
          if (estimatedCostKrw > remainingBudgetKrw) {
            result.degradedReasons.push(`package:${packageId}:DOCUMENT_EXTERNAL_COST_LIMIT_REACHED`);
          } else {
            for (const providerName of activeProviders) {
              const execution = await executeScheduleProviderEffectivelyOnce({
                supabase: input.supabase,
                tenantId: input.tenantId,
                jobId: input.jobId,
                revisionId,
                revisionHash,
                sourceHash: input.sourceHash,
                provider: providerName,
                operationScope: `registration:${input.jobId}:${revisionId}`,
                query,
              });
              providerObservations.push(...execution.result.observations);
              result.totalExternalCostKrw += execution.chargedCostKrw;
            }
            for (const providerName of disabledProviders) {
              result.degradedReasons.push(
                `package:${packageId}:${providerName.toUpperCase()}_KILL_SWITCH_ACTIVE`,
              );
            }
          }
          for (const observation of providerObservations) {
            const id = await recordTransportObservation({ supabase: input.supabase, observation: { ...observation, revisionHash } });
            observations.push({ ...observation, revisionHash, id });
          }
        }
        const resolved = resolveTransportFact({ source, observations });
        result.blockers.push(...resolved.blockers.map(reason => `package:${packageId}:segment:${segmentIndex}:${reason}`));
        result.degradedReasons.push(...resolved.degradedReasons.map(reason => `package:${packageId}:segment:${segmentIndex}:${reason}`));
        const resolvedRow = {
          tenant_id: input.tenantId,
          product_revision_id: revisionId,
          section_index: packageIndex,
          variant_key: `package-${packageId}`,
          leg: normalizedLeg(segment.leg),
          departure_date: date,
          service_number: resolved.fact.serviceNumber,
          departure_airport: resolved.fact.departureAirport,
          arrival_airport: resolved.fact.arrivalAirport,
          departure_local_time: resolved.fact.departureLocalTime,
          arrival_local_time: resolved.fact.arrivalLocalTime,
          arrival_day_offset: resolved.fact.arrivalDayOffset,
          resolution_state: resolved.state,
          observation_ids: resolved.observationIds,
          reasons: [...resolved.degradedReasons, ...resolved.blockers],
          source_hash: input.sourceHash,
          revision_hash: revisionHash,
          resolution_hash: '',
          created_version: 'product-registration-v6-facts-1',
        };
        resolvedRow.resolution_hash = resolutionHash({ ...resolvedRow, resolution_hash: undefined });
        const { error: resolutionError } = await input.supabase.rpc('record_product_registration_v6_transport_resolution', {
          p_payload: resolvedRow,
        });
        if (resolutionError) throw resolutionError;
        result.resolvedTransport.push({
          packageId,
          leg: normalizedLeg(segment.leg),
          serviceNumber: currentObservation.serviceNumber,
          departureAirport: currentObservation.departureAirport,
          arrivalAirport: currentObservation.arrivalAirport,
          departureDate: date,
          departureLocalTime: resolved.fact.departureLocalTime,
          arrivalLocalTime: resolved.fact.arrivalLocalTime,
          arrivalDayOffset: resolved.fact.arrivalDayOffset,
          state: resolved.state,
          verifiedByCurrentProviders: resolved.verifiedByCurrentProviders,
        });
      }
    }
  }
  result.blockers = [...new Set(result.blockers)];
  result.degradedReasons = [...new Set(result.degradedReasons)];
  return result;
}

export function catalogProductsEligibleForScheduleDriftClear(input: {
  packageIds: string[];
  catalogProductIds: string[];
  shared: SharedFactJobResult;
}): string[] {
  return input.packageIds.flatMap((packageId, index) => {
    const catalogProductId = input.catalogProductIds[index];
    if (!catalogProductId) return [];
    const packagePrefix = `package:${packageId}:`;
    if (input.shared.blockers.some(blocker => blocker.startsWith(packagePrefix))) return [];
    const transport = input.shared.resolvedTransport.filter(item => item.packageId === packageId);
    if (transport.length === 0 || transport.some(item => !item.verifiedByCurrentProviders)) return [];
    return [catalogProductId];
  });
}
