import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

export const TRANSPORT_SOURCE_WEIGHTS = {
  current_source: 1,
  oag: 0.98,
  cirium: 0.96,
  verified_product: 0.8,
  legacy_product: 0.45,
  ai: 0,
} as const;

export type TransportSourceKind = keyof Omit<typeof TRANSPORT_SOURCE_WEIGHTS, 'ai'>;

export type TransportFactObservation = {
  id?: string;
  tenantId: string | null;
  sourceDocumentId?: string | null;
  productRevisionId?: string | null;
  packageId?: string | null;
  sourceKind: TransportSourceKind;
  sourceFamily: string;
  carrierCode: string | null;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  operatingWeekdays: number[];
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
  departureTimezone: string | null;
  arrivalTimezone: string | null;
  observedAt: string;
  verifiedAt?: string | null;
  sourceWeight: number;
  sourceHash: string;
  revisionHash?: string | null;
  evidence: unknown[];
  observationHash: string;
};

export type SourceTransportFact = {
  carrierCode: string | null;
  serviceNumber: string | null;
  departureAirport: string | null;
  arrivalAirport: string | null;
  departureDate: string | null;
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
};

export type TransportFactResolution = {
  state: 'source_confirmed' | 'corroborated' | 'degraded' | 'conflicting';
  fact: SourceTransportFact;
  observationIds: string[];
  verifiedByCurrentProviders: boolean;
  degradedReasons: string[];
  blockers: string[];
};

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, '').toUpperCase() ?? '';
  return normalized || null;
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/[^0-9:]/g, '');
  const match = compact.match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : null;
}

function validServiceNumber(value: string | null): boolean {
  return Boolean(value && /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(value));
}

function validAirport(value: string | null): boolean {
  return Boolean(value && /^[A-Z]{3}$/.test(value));
}

function dateApplies(observation: TransportFactObservation, departureDate: string): boolean {
  if (observation.effectiveStart && observation.effectiveStart > departureDate) return false;
  if (observation.effectiveEnd && observation.effectiveEnd < departureDate) return false;
  if (observation.operatingWeekdays.length === 0) return true;
  const weekday = new Date(`${departureDate}T00:00:00Z`).getUTCDay();
  return observation.operatingWeekdays.includes(weekday);
}

function normalizedSource(source: SourceTransportFact): SourceTransportFact {
  return {
    carrierCode: normalizeCode(source.carrierCode),
    serviceNumber: normalizeCode(source.serviceNumber),
    departureAirport: normalizeCode(source.departureAirport),
    arrivalAirport: normalizeCode(source.arrivalAirport),
    departureDate: source.departureDate,
    departureLocalTime: normalizeTime(source.departureLocalTime),
    arrivalLocalTime: normalizeTime(source.arrivalLocalTime),
    arrivalDayOffset: Number.isInteger(source.arrivalDayOffset) ? source.arrivalDayOffset : 0,
  };
}

function observationTimeKey(observation: TransportFactObservation): string | null {
  const departure = normalizeTime(observation.departureLocalTime);
  const arrival = normalizeTime(observation.arrivalLocalTime);
  if (!departure || !arrival) return null;
  return `${departure}|${arrival}|${observation.arrivalDayOffset}`;
}

/**
 * Resolves only missing times. Source identity and explicit source times are
 * immutable. Provider/history observations can corroborate but never replace
 * a value stated in the newly uploaded supplier document.
 */
export function resolveTransportFact(input: {
  source: SourceTransportFact;
  observations: TransportFactObservation[];
}): TransportFactResolution {
  const source = normalizedSource(input.source);
  const blockers: string[] = [];
  const degradedReasons: string[] = [];
  if (!validServiceNumber(source.serviceNumber)) blockers.push('FLIGHT_SERVICE_NUMBER_INVALID');
  if (!validAirport(source.departureAirport) || !validAirport(source.arrivalAirport)) {
    blockers.push('FLIGHT_ROUTE_INVALID_OR_FIELD_SHIFTED');
  }
  if (source.departureAirport && source.arrivalAirport && source.departureAirport === source.arrivalAirport) {
    blockers.push('FLIGHT_ROUTE_IDENTICAL_AIRPORTS');
  }
  if (!source.departureDate) blockers.push('FLIGHT_DEPARTURE_DATE_MISSING');
  if (source.arrivalDayOffset < -1 || source.arrivalDayOffset > 3) blockers.push('FLIGHT_ARRIVAL_DAY_OFFSET_INVALID');
  if (blockers.length > 0) {
    return {
      state: 'conflicting',
      fact: source,
      observationIds: [],
      verifiedByCurrentProviders: false,
      degradedReasons,
      blockers,
    };
  }

  const matching = input.observations.filter(observation =>
    normalizeCode(observation.serviceNumber) === source.serviceNumber
    && normalizeCode(observation.departureAirport) === source.departureAirport
    && normalizeCode(observation.arrivalAirport) === source.arrivalAirport
    && Boolean(source.departureDate && dateApplies(observation, source.departureDate))
    && observation.sourceWeight > 0,
  );
  const groups = new Map<string, TransportFactObservation[]>();
  for (const observation of matching) {
    const key = observationTimeKey(observation);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }

  const corroborated = [...groups.entries()].filter(([, observations]) => {
    const sourceFamilies = new Set(observations.map(item => item.sourceFamily));
    const averageWeight = observations.reduce((sum, item) => sum + item.sourceWeight, 0) / observations.length;
    return sourceFamilies.size >= 2 && averageWeight >= 0.95;
  });

  // Explicit supplier times remain immutable, but two independent current
  // schedule providers may prove that the published schedule changed. Keep
  // the source value for audit and fail closed instead of silently replacing
  // it with the external value.
  if (source.departureLocalTime && source.arrivalLocalTime) {
    const sourceKey = `${source.departureLocalTime}|${source.arrivalLocalTime}|${source.arrivalDayOffset}`;
    const providerConsensus = corroborated.filter(([, observations]) => {
      const families = new Set(observations.map(item => item.sourceFamily));
      return families.has('oag') && families.has('cirium');
    });
    const conflictingConsensus = providerConsensus.filter(([key]) => key !== sourceKey);
    if (conflictingConsensus.length > 0) {
      blockers.push('FLIGHT_SOURCE_PROVIDER_TIME_CONFLICT');
      return {
        state: 'conflicting',
        fact: source,
        observationIds: conflictingConsensus.flatMap(([, observations]) => observations.map(item => item.id))
          .filter((value): value is string => Boolean(value)),
        verifiedByCurrentProviders: false,
        degradedReasons,
        blockers,
      };
    }
    const matchingProviderConsensus = providerConsensus.filter(([key]) => key === sourceKey);
    return {
      state: 'source_confirmed',
      fact: source,
      observationIds: matchingProviderConsensus.flatMap(([, observations]) => observations.map(item => item.id))
        .filter((value): value is string => Boolean(value)),
      verifiedByCurrentProviders: matchingProviderConsensus.length > 0,
      degradedReasons,
      blockers,
    };
  }

  if (corroborated.length === 1) {
    const [key, observations] = corroborated[0]!;
    const [departureLocalTime, arrivalLocalTime, dayOffset] = key.split('|');
    return {
      state: 'corroborated',
      fact: {
        ...source,
        departureLocalTime: source.departureLocalTime ?? departureLocalTime!,
        arrivalLocalTime: source.arrivalLocalTime ?? arrivalLocalTime!,
        arrivalDayOffset: Number(dayOffset),
      },
      observationIds: observations.map(item => item.id).filter((value): value is string => Boolean(value)),
      verifiedByCurrentProviders: observations.some(item => item.sourceFamily === 'oag')
        && observations.some(item => item.sourceFamily === 'cirium'),
      degradedReasons,
      blockers,
    };
  }

  if (corroborated.length > 1) {
    degradedReasons.push('FLIGHT_TIME_VARIANTS_CONFLICT: 날짜·노선이 같은 독립 출처에 서로 다른 운항 시각이 있습니다.');
  } else {
    degradedReasons.push('FLIGHT_TIME_NOT_CORROBORATED: 두 독립 고신뢰 출처가 분 단위로 일치하지 않아 시간을 숨깁니다.');
  }
  return {
    state: corroborated.length > 1 ? 'conflicting' : 'degraded',
    fact: source,
    observationIds: matching.map(item => item.id).filter((value): value is string => Boolean(value)),
    verifiedByCurrentProviders: false,
    degradedReasons,
    blockers,
  };
}

export function buildTransportObservationHash(
  observation: Omit<TransportFactObservation, 'observationHash'>,
): string {
  const stable = {
    ...observation,
    carrierCode: normalizeCode(observation.carrierCode),
    serviceNumber: normalizeCode(observation.serviceNumber),
    departureAirport: normalizeCode(observation.departureAirport),
    arrivalAirport: normalizeCode(observation.arrivalAirport),
    departureLocalTime: normalizeTime(observation.departureLocalTime),
    arrivalLocalTime: normalizeTime(observation.arrivalLocalTime),
    operatingWeekdays: [...observation.operatingWeekdays].sort(),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export async function listTransportObservations(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
}): Promise<TransportFactObservation[]> {
  const { data, error } = await input.supabase.rpc('list_product_registration_v6_transport_observations', {
    p_tenant_id: input.tenantId,
    p_service_number: input.serviceNumber,
    p_departure_airport: input.departureAirport,
    p_arrival_airport: input.arrivalAirport,
    p_departure_date: input.departureDate,
    p_limit: 100,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map(raw => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      tenantId: typeof row.tenant_id === 'string' ? row.tenant_id : null,
      sourceDocumentId: typeof row.source_document_id === 'string' ? row.source_document_id : null,
      productRevisionId: typeof row.product_revision_id === 'string' ? row.product_revision_id : null,
      packageId: typeof row.package_id === 'string' ? row.package_id : null,
      sourceKind: String(row.source_kind) as TransportSourceKind,
      sourceFamily: String(row.source_family ?? row.source_kind),
      carrierCode: typeof row.carrier_code === 'string' ? row.carrier_code : null,
      serviceNumber: String(row.service_number),
      departureAirport: String(row.departure_airport),
      arrivalAirport: String(row.arrival_airport),
      effectiveStart: typeof row.effective_start === 'string' ? row.effective_start : null,
      effectiveEnd: typeof row.effective_end === 'string' ? row.effective_end : null,
      operatingWeekdays: Array.isArray(row.operating_weekdays) ? row.operating_weekdays.map(Number) : [],
      departureLocalTime: typeof row.departure_local_time === 'string' ? row.departure_local_time : null,
      arrivalLocalTime: typeof row.arrival_local_time === 'string' ? row.arrival_local_time : null,
      arrivalDayOffset: Number(row.arrival_day_offset ?? 0),
      departureTimezone: typeof row.departure_timezone === 'string' ? row.departure_timezone : null,
      arrivalTimezone: typeof row.arrival_timezone === 'string' ? row.arrival_timezone : null,
      observedAt: String(row.observed_at),
      verifiedAt: typeof row.verified_at === 'string' ? row.verified_at : null,
      sourceWeight: Number(row.source_weight),
      sourceHash: String(row.source_hash),
      revisionHash: typeof row.revision_hash === 'string' ? row.revision_hash : null,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
      observationHash: String(row.observation_hash),
    };
  });
}

export async function recordTransportObservation(input: {
  supabase: SupabaseClient;
  observation: TransportFactObservation;
}): Promise<string> {
  const observation = input.observation;
  const { data, error } = await input.supabase.rpc('record_product_registration_v6_transport_observation', {
    p_payload: {
      tenant_id: observation.tenantId,
      source_document_id: observation.sourceDocumentId ?? null,
      product_revision_id: observation.productRevisionId ?? null,
      package_id: observation.packageId ?? null,
      source_kind: observation.sourceKind,
      source_family: observation.sourceFamily,
      carrier_code: observation.carrierCode,
      service_number: observation.serviceNumber,
      departure_airport: observation.departureAirport,
      arrival_airport: observation.arrivalAirport,
      effective_start: observation.effectiveStart,
      effective_end: observation.effectiveEnd,
      operating_weekdays: observation.operatingWeekdays,
      departure_local_time: observation.departureLocalTime,
      arrival_local_time: observation.arrivalLocalTime,
      arrival_day_offset: observation.arrivalDayOffset,
      departure_timezone: observation.departureTimezone,
      arrival_timezone: observation.arrivalTimezone,
      observed_at: observation.observedAt,
      verified_at: observation.verifiedAt ?? null,
      source_weight: observation.sourceWeight,
      source_hash: observation.sourceHash,
      revision_hash: observation.revisionHash ?? null,
      evidence: observation.evidence,
      observation_hash: observation.observationHash,
      created_version: 'product-registration-v6-facts-1',
    },
  });
  if (error) throw error;
  return String((data as { id?: unknown } | null)?.id ?? '');
}
