import { TRANSPORT_SOURCE_WEIGHTS, buildTransportObservationHash, type TransportFactObservation } from './transport-facts';
import { getSecret, type SecretKey } from '@/lib/secret-registry';

export type ScheduleProviderQuery = {
  tenantId: string | null;
  carrierCode: string;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  sourceHash: string;
  productRevisionId?: string | null;
  packageId?: string | null;
};

export type ScheduleProviderResult = {
  provider: 'oag' | 'cirium';
  status: 'succeeded' | 'unavailable' | 'failed';
  observations: TransportFactObservation[];
  costKrw: number;
  error?: string;
};

function splitFlightNumber(serviceNumber: string): { carrier: string; number: string } | null {
  const match = serviceNumber.replace(/\s+/g, '').toUpperCase().match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  return match ? { carrier: match[1]!, number: match[2]! } : null;
}

function clock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hhmm = value.match(/T([01]\d|2[0-3]):([0-5]\d)/)
    ?? value.match(/(?:^|\s)([01]\d|2[0-3]):?([0-5]\d)(?:$|\s)/);
  return hhmm ? `${hhmm[1]}:${hhmm[2]}` : null;
}

function arrayAt(value: unknown, keys: string[]): unknown[] {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return [];
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : [];
}

function property(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function estimatedCost(envName: SecretKey): number {
  const value = Number(getSecret(envName) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function estimatedIndependentScheduleCostKrw(): number {
  return (getSecret('OAG_SUBSCRIPTION_KEY') ? estimatedCost('OAG_COST_KRW_PER_CALL') : 0)
    + (getSecret('CIRIUM_APP_ID') && getSecret('CIRIUM_APP_KEY') ? estimatedCost('CIRIUM_COST_KRW_PER_CALL') : 0);
}

export function estimatedScheduleProviderCostKrw(provider: 'oag' | 'cirium'): number {
  if (provider === 'oag') {
    return getSecret('OAG_SUBSCRIPTION_KEY') ? estimatedCost('OAG_COST_KRW_PER_CALL') : 0;
  }
  return getSecret('CIRIUM_APP_ID') && getSecret('CIRIUM_APP_KEY')
    ? estimatedCost('CIRIUM_COST_KRW_PER_CALL')
    : 0;
}

function makeObservation(input: {
  query: ScheduleProviderQuery;
  provider: 'oag' | 'cirium';
  carrierCode: string | null;
  serviceNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureLocalTime: string | null;
  arrivalLocalTime: string | null;
  arrivalDayOffset: number;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  departureTimezone?: string | null;
  arrivalTimezone?: string | null;
}): TransportFactObservation {
  const withoutHash: Omit<TransportFactObservation, 'observationHash'> = {
    tenantId: input.query.tenantId,
    productRevisionId: input.query.productRevisionId ?? null,
    packageId: input.query.packageId ?? null,
    sourceKind: input.provider,
    sourceFamily: input.provider,
    carrierCode: input.carrierCode,
    serviceNumber: input.serviceNumber,
    departureAirport: input.departureAirport,
    arrivalAirport: input.arrivalAirport,
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
    operatingWeekdays: [],
    departureLocalTime: input.departureLocalTime,
    arrivalLocalTime: input.arrivalLocalTime,
    arrivalDayOffset: input.arrivalDayOffset,
    departureTimezone: input.departureTimezone ?? null,
    arrivalTimezone: input.arrivalTimezone ?? null,
    observedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    sourceWeight: TRANSPORT_SOURCE_WEIGHTS[input.provider],
    sourceHash: input.query.sourceHash,
    revisionHash: null,
    evidence: [{ provider: input.provider, departureDate: input.query.departureDate }],
  };
  return { ...withoutHash, observationHash: buildTransportObservationHash(withoutHash) };
}

async function fetchJson(url: URL, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOagSchedule(input: ScheduleProviderQuery): Promise<ScheduleProviderResult> {
  const key = getSecret('OAG_SUBSCRIPTION_KEY');
  if (!key) return { provider: 'oag', status: 'unavailable', observations: [], costKrw: 0, error: 'OAG_SUBSCRIPTION_KEY_MISSING' };
  const split = splitFlightNumber(input.serviceNumber);
  if (!split) return { provider: 'oag', status: 'failed', observations: [], costKrw: 0, error: 'FLIGHT_NUMBER_INVALID' };
  const costKrw = estimatedCost('OAG_COST_KRW_PER_CALL');
  if (costKrw > 2_000) return { provider: 'oag', status: 'failed', observations: [], costKrw: 0, error: 'PROVIDER_COST_LIMIT_EXCEEDED' };
  const url = new URL(getSecret('OAG_FLIGHT_INFO_URL') ?? 'https://api.oag.com/flight-instances/');
  url.searchParams.set('CarrierCode', input.carrierCode || split.carrier);
  url.searchParams.set('FlightNumber', split.number.replace(/[^0-9]/g, ''));
  url.searchParams.set('DepartureAirport', input.departureAirport);
  url.searchParams.set('ArrivalAirport', input.arrivalAirport);
  url.searchParams.set('DepartureDateTime', input.departureDate);
  url.searchParams.set('CodeType', 'IATA');
  url.searchParams.set('Limit', '10');
  try {
    const payload = await fetchJson(url, { 'Subscription-Key': key, Accept: 'application/json' });
    const rows = Array.isArray(payload)
      ? payload
      : arrayAt(payload, ['data']).length > 0
        ? arrayAt(payload, ['data'])
        : arrayAt(payload, ['flightInstances']);
    const observations = rows.map(row => makeObservation({
      query: input,
      provider: 'oag',
      carrierCode: String(property(row, ['carrier', 'iata']) ?? input.carrierCode),
      serviceNumber: `${String(property(row, ['carrier', 'iata']) ?? split.carrier)}${String(property(row, ['flightNumber']) ?? split.number)}`,
      departureAirport: String(property(row, ['departure', 'airport', 'iata']) ?? property(row, ['departure', 'airport']) ?? input.departureAirport),
      arrivalAirport: String(property(row, ['arrival', 'airport', 'iata']) ?? property(row, ['arrival', 'airport']) ?? input.arrivalAirport),
      departureLocalTime: clock(property(row, ['departure', 'passengerLocalTime']) ?? property(row, ['departure', 'date', 'local'])),
      arrivalLocalTime: clock(property(row, ['arrival', 'passengerLocalTime']) ?? property(row, ['arrival', 'date', 'local'])),
      arrivalDayOffset: Number(property(row, ['arrivalIntervalDays']) ?? property(row, ['legArrivalIntervalDays']) ?? 0),
      effectiveStart: String(property(row, ['startDate']) ?? input.departureDate),
      effectiveEnd: String(property(row, ['endDate']) ?? input.departureDate),
    })).filter(item => item.departureAirport === input.departureAirport && item.arrivalAirport === input.arrivalAirport);
    return { provider: 'oag', status: 'succeeded', observations, costKrw };
  } catch (error) {
    return { provider: 'oag', status: 'failed', observations: [], costKrw, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchCiriumSchedule(input: ScheduleProviderQuery): Promise<ScheduleProviderResult> {
  const appId = getSecret('CIRIUM_APP_ID');
  const appKey = getSecret('CIRIUM_APP_KEY');
  if (!appId || !appKey) return { provider: 'cirium', status: 'unavailable', observations: [], costKrw: 0, error: 'CIRIUM_CREDENTIALS_MISSING' };
  const split = splitFlightNumber(input.serviceNumber);
  if (!split) return { provider: 'cirium', status: 'failed', observations: [], costKrw: 0, error: 'FLIGHT_NUMBER_INVALID' };
  const costKrw = estimatedCost('CIRIUM_COST_KRW_PER_CALL');
  if (costKrw > 2_000) return { provider: 'cirium', status: 'failed', observations: [], costKrw: 0, error: 'PROVIDER_COST_LIMIT_EXCEEDED' };
  const [year, month, day] = input.departureDate.split('-');
  const base = (getSecret('CIRIUM_SCHEDULES_URL') ?? 'https://api.flightstats.com/flex/schedules/rest/v1/json/flight').replace(/\/$/, '');
  const url = new URL(`${base}/${split.carrier}/${split.number}/${year}/${month}/${day}`);
  url.searchParams.set('appId', appId);
  url.searchParams.set('appKey', appKey);
  try {
    const payload = await fetchJson(url, { Accept: 'application/json' });
    const rows = arrayAt(payload, ['scheduledFlights']);
    const observations = rows.map(row => {
      const departureTime = String(property(row, ['departureTime']) ?? '');
      const arrivalTime = String(property(row, ['arrivalTime']) ?? '');
      const departureDate = departureTime.slice(0, 10);
      const arrivalDate = arrivalTime.slice(0, 10);
      const dayOffset = departureDate && arrivalDate
        ? Math.round((Date.parse(`${arrivalDate}T00:00:00Z`) - Date.parse(`${departureDate}T00:00:00Z`)) / 86_400_000)
        : 0;
      return makeObservation({
        query: input,
        provider: 'cirium',
        carrierCode: String(property(row, ['carrierFsCode']) ?? split.carrier),
        serviceNumber: `${String(property(row, ['carrierFsCode']) ?? split.carrier)}${String(property(row, ['flightNumber']) ?? split.number)}`,
        departureAirport: String(property(row, ['departureAirportFsCode']) ?? input.departureAirport),
        arrivalAirport: String(property(row, ['arrivalAirportFsCode']) ?? input.arrivalAirport),
        departureLocalTime: clock(departureTime),
        arrivalLocalTime: clock(arrivalTime),
        arrivalDayOffset: dayOffset,
        effectiveStart: input.departureDate,
        effectiveEnd: input.departureDate,
      });
    }).filter(item => item.departureAirport === input.departureAirport && item.arrivalAirport === input.arrivalAirport);
    return { provider: 'cirium', status: 'succeeded', observations, costKrw };
  } catch (error) {
    return { provider: 'cirium', status: 'failed', observations: [], costKrw, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchIndependentSchedules(input: ScheduleProviderQuery, options: {
  remainingBudgetKrw?: number;
  disabledProviders?: Array<'oag' | 'cirium'>;
} = {}): Promise<{
  results: ScheduleProviderResult[];
  observations: TransportFactObservation[];
  totalCostKrw: number;
}> {
  const estimate = estimatedIndependentScheduleCostKrw();
  if (estimate > (options.remainingBudgetKrw ?? 2_000)) throw new Error('DOCUMENT_EXTERNAL_COST_LIMIT_EXCEEDED');
  const disabled = new Set(options.disabledProviders ?? []);
  const results = await Promise.all([
    disabled.has('oag')
      ? Promise.resolve({ provider: 'oag', status: 'unavailable', observations: [], costKrw: 0, error: 'OAG_KILL_SWITCH_ACTIVE' } as ScheduleProviderResult)
      : fetchOagSchedule(input),
    disabled.has('cirium')
      ? Promise.resolve({ provider: 'cirium', status: 'unavailable', observations: [], costKrw: 0, error: 'CIRIUM_KILL_SWITCH_ACTIVE' } as ScheduleProviderResult)
      : fetchCiriumSchedule(input),
  ]);
  const totalCostKrw = results.reduce((sum, result) => sum + result.costKrw, 0);
  if (totalCostKrw > 2_000) throw new Error('DOCUMENT_EXTERNAL_COST_LIMIT_EXCEEDED');
  return { results, observations: results.flatMap(result => result.observations), totalCostKrw };
}
