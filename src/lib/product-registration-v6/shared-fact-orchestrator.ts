import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchIndependentSchedules, type ScheduleProviderResult } from './schedule-providers';
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
  packageId: string;
  leg: string;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
  state: 'source_confirmed' | 'corroborated' | 'degraded' | 'conflicting';
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

function departureDates(pkg: JsonObject): string[] {
  const rows = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  return [...new Set(rows.map(row => string(asObject(row)?.date)).filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date))))]
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
  packageId: string;
  sourceHash: string;
  segment: JsonObject;
  date: string;
}): TransportFactObservation | null {
  const serviceNumber = string(input.segment.flight_no ?? input.segment.code)?.replace(/\s+/g, '').toUpperCase();
  const departureAirport = normalizeAirport(input.segment.dep_airport ?? input.segment.departure_airport);
  const arrivalAirport = normalizeAirport(input.segment.arr_airport ?? input.segment.arrival_airport);
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
    departureLocalTime: string(input.segment.dep_time),
    arrivalLocalTime: string(input.segment.arr_time),
    arrivalDayOffset: Number(input.segment.arr_day_offset ?? 0),
    departureTimezone: null,
    arrivalTimezone: null,
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

async function recordProviderResult(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
  jobId: string;
  revisionId: string;
  revisionHash: string;
  sourceHash: string;
  operationKey: string;
  result: ScheduleProviderResult;
}): Promise<boolean> {
  const summary = {
    status: input.result.status,
    observationHashes: input.result.observations.map(row => row.observationHash),
    error: input.result.error ?? null,
  };
  const { data, error } = await input.supabase.rpc('record_product_registration_v6_provider_call', {
    p_payload: {
      tenant_id: input.tenantId,
      job_id: input.jobId,
      product_revision_id: input.revisionId,
      provider: input.result.provider,
      operation: 'schedule_lookup',
      operation_key: `${input.operationKey}:${input.result.provider}`,
      request_hash: resolutionHash({ operationKey: input.operationKey, provider: input.result.provider }),
      response_hash: resolutionHash(summary),
      status: input.result.status === 'succeeded' ? 'succeeded' : input.result.status === 'unavailable' ? 'skipped' : 'failed',
      billed_units: 1,
      cost_krw: input.result.costKrw,
      source_hash: input.sourceHash,
      revision_hash: input.revisionHash,
      result: summary,
    },
  });
  if (error) throw error;
  return Boolean((data as { inserted?: unknown } | null)?.inserted);
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
    const { data: revision, error: revisionError } = await input.supabase
      .from('product_registration_v5_revisions')
      .select('payload_hash')
      .eq('id', revisionId)
      .single();
    if (revisionError || !revision?.payload_hash) {
      result.blockers.push(`package:${packageId}:CANONICAL_REVISION_HASH_MISSING`);
      continue;
    }
    const revisionHash = String(revision.payload_hash);
    const { data: pkg, error } = await input.supabase
      .from('travel_packages')
      .select('id,itinerary_data,price_dates')
      .eq('id', packageId)
      .single();
    if (error || !pkg) {
      result.blockers.push(`package:${packageId}:PACKAGE_FACTS_UNAVAILABLE`);
      continue;
    }
    const itinerary = asObject(pkg.itinerary_data) ?? {};
    const segments = Array.isArray(itinerary.flight_segments)
      ? itinerary.flight_segments.map(asObject).filter((item): item is JsonObject => Boolean(item))
      : [];
    const dates = departureDates(pkg as JsonObject);
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
          packageId,
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
        const existingResolution = resolveTransportFact({ source, observations });
        if ((!source.departureLocalTime || !source.arrivalLocalTime) && existingResolution.state !== 'corroborated') {
          const provider = await fetchIndependentSchedules({
            tenantId: input.tenantId,
            carrierCode: currentObservation.carrierCode ?? '',
            serviceNumber: currentObservation.serviceNumber,
            departureAirport: currentObservation.departureAirport,
            arrivalAirport: currentObservation.arrivalAirport,
            departureDate: date,
            sourceHash: input.sourceHash,
            productRevisionId: revisionId,
            packageId,
          }, {
            remainingBudgetKrw: Math.max(0, 2_000 - existingExternalCostKrw - result.totalExternalCostKrw),
            disabledProviders,
          }).catch(error => {
            result.degradedReasons.push(`package:${packageId}:DOCUMENT_EXTERNAL_COST_LIMIT_REACHED`);
            return { results: [], observations: [], totalCostKrw: 0, error };
          });
          let newlyRecordedCostKrw = 0;
          for (const providerResult of provider.results) {
            const inserted = await recordProviderResult({
              supabase: input.supabase,
              tenantId: input.tenantId,
              jobId: input.jobId,
              revisionId,
              revisionHash,
              sourceHash: input.sourceHash,
              operationKey: `${currentObservation.serviceNumber}:${currentObservation.departureAirport}:${currentObservation.arrivalAirport}:${date}`,
              result: providerResult,
            });
            if (inserted) newlyRecordedCostKrw += providerResult.costKrw;
          }
          result.totalExternalCostKrw += newlyRecordedCostKrw;
          for (const observation of provider.observations) {
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
        });
      }
    }
  }
  result.blockers = [...new Set(result.blockers)];
  result.degradedReasons = [...new Set(result.degradedReasons)];
  return result;
}
