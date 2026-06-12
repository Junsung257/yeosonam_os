import type { PriceDate } from '@/lib/price-dates';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import { findItineraryScheduleQualityIssues, type ItineraryScheduleQualityDay } from './itinerary-quality-gate';

export type UploadDeliverabilityResult = {
  ok: boolean;
  blockers: string[];
};

export type UploadDeliverabilityInput = {
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
  destination?: string | null;
  destinationCode?: string | null;
  internalCode?: string | null;
  itineraryData?: unknown;
  itineraryDays?: ItineraryScheduleQualityDay[] | null;
  durationDays?: number | null;
  rawText?: string | null;
  priceRecoveryFailures?: string[];
  extraFailures?: string[];
};

const RISK_CONTEXT_RE =
  /(optional|option|tour|ticket|admission|surcharge|cancel|cancellation|penalty|fee|charge|\uC120\uD0DD\s*\uAD00\uAD11|\uCD94\uCC9C\s*\uAD00\uAD11|\uC785\uC7A5\uAD8C|\uCD94\uAC00\s*\uC694\uAE08|\uCD94\uAC00\uAE08|\uCC28\uC9C0|\uC368\uCC28\uC9C0|\uD604\uC9C0\s*\uC9C0\uC0C1\uBE44|\uCEE8\uC2DC\uC9C0\uC5B4|2B|3B|\uCE90\uB514|\uC218\uC218\uB8CC|\uCDE8\uC18C|\uC608\uC57D\uAE08)/i;
const AMOUNT_RE = /(\d{1,3}(?:,\d{3})+|\d+)\s*(\uB9CC\uC6D0|\uC6D0|krw|,-)?/gi;
const PRICE_MIN = 10_000;
const PRICE_MAX = 50_000_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function isValidCustomerPrice(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= PRICE_MIN
    && value <= PRICE_MAX;
}

function minNetPrice(rows: ProductPriceRowInput[]): number | null {
  const prices = rows
    .map(row => row.net_price)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function collectPositivePrices(input: UploadDeliverabilityInput): number[] {
  const values = [
    ...input.priceRows.flatMap(row => [row.net_price, row.adult_selling_price, row.child_price]),
    ...input.priceDates.map(row => row.price),
  ];
  return [...new Set(values.filter((price): price is number => (
    typeof price === 'number'
    && Number.isFinite(price)
    && price > 0
  )))];
}

function normalizeKrwAmount(value: string, unit?: string): number | null {
  const amount = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit?.toLowerCase() === '만원') return amount * 10000;
  return amount < 10000 && !unit ? amount * 1000 : amount;
}

function extractRiskContextPrices(rawText: string): number[] {
  const prices = new Set<number>();

  for (const line of rawText.split(/\r?\n/)) {
    if (!RISK_CONTEXT_RE.test(line)) continue;

    for (const match of line.matchAll(AMOUNT_RE)) {
      const price = normalizeKrwAmount(match[1], match[2]);
      if (price != null) prices.add(price);
    }
  }

  return [...prices];
}

function sortedUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function findPriceStorageMismatch(input: UploadDeliverabilityInput): string | null {
  if (input.priceDates.length === 0) return null;

  const pricesByDate = new Map<string, number[]>();
  for (const row of input.priceRows) {
    if (!row.target_date || !Number.isFinite(row.net_price) || row.net_price <= 0) continue;
    const prices = pricesByDate.get(row.target_date) ?? [];
    prices.push(row.net_price);
    pricesByDate.set(row.target_date, prices);
  }

  const priceDateByDate = new Map(input.priceDates.map(priceDate => [priceDate.date, priceDate]));
  for (const date of [...pricesByDate.keys()].sort()) {
    if (!priceDateByDate.has(date)) return `price_dates missing date ${date}`;
  }

  for (const priceDate of input.priceDates) {
    const rowPrices = pricesByDate.get(priceDate.date);
    if (!rowPrices || rowPrices.length === 0) return `product_prices missing date ${priceDate.date}`;
    const minRowPrice = Math.min(...rowPrices);
    if (minRowPrice !== priceDate.price) {
      return `price storage mismatch ${priceDate.date}: product_prices min ${minRowPrice.toLocaleString()} != price_dates ${priceDate.price.toLocaleString()}`;
    }
  }

  return null;
}

function findPriceShapeError(input: UploadDeliverabilityInput): string | null {
  const seenPriceDates = new Set<string>();
  for (const priceDate of input.priceDates) {
    if (!isValidIsoDate(priceDate.date)) return `price_dates invalid date ${priceDate.date}`;
    if (seenPriceDates.has(priceDate.date)) return `price_dates duplicate date ${priceDate.date}`;
    seenPriceDates.add(priceDate.date);
    if (!isValidCustomerPrice(priceDate.price)) {
      return `price_dates invalid price ${priceDate.date}: ${String(priceDate.price)}`;
    }
    if (priceDate.child_price != null && !isValidCustomerPrice(priceDate.child_price)) {
      return `price_dates invalid child_price ${priceDate.date}: ${String(priceDate.child_price)}`;
    }
  }

  for (const row of input.priceRows) {
    if (row.target_date != null && !isValidIsoDate(row.target_date)) {
      return `product_prices invalid target_date ${row.target_date}`;
    }
    if (!isValidCustomerPrice(row.net_price)) {
      return `product_prices invalid net_price ${row.target_date ?? row.day_of_week ?? 'undated'}: ${String(row.net_price)}`;
    }
    if (row.adult_selling_price != null && !isValidCustomerPrice(row.adult_selling_price)) {
      return `product_prices invalid adult_selling_price ${row.target_date ?? row.day_of_week ?? 'undated'}: ${String(row.adult_selling_price)}`;
    }
    if (
      row.adult_selling_price != null
      && isValidCustomerPrice(row.adult_selling_price)
      && row.adult_selling_price < row.net_price
    ) {
      return `product_prices adult_selling_price below net_price ${row.target_date ?? row.day_of_week ?? 'undated'}`;
    }
    if (row.child_price != null && (!Number.isInteger(row.child_price) || row.child_price < 0 || row.child_price > PRICE_MAX)) {
      return `product_prices invalid child_price ${row.target_date ?? row.day_of_week ?? 'undated'}: ${String(row.child_price)}`;
    }
  }

  return null;
}

function findMissingCustomerSellingPrice(input: UploadDeliverabilityInput): string | null {
  const missing = input.priceRows.find(row => (
    typeof row.net_price === 'number'
    && Number.isFinite(row.net_price)
    && row.net_price > 0
    && (
      typeof row.adult_selling_price !== 'number'
      || !Number.isFinite(row.adult_selling_price)
      || row.adult_selling_price <= 0
    )
  ));

  if (!missing) return null;
  const date = missing.target_date ?? missing.day_of_week ?? 'undated';
  return `adult_selling_price missing for positive product_prices row ${date} net ${missing.net_price.toLocaleString()} KRW`;
}

function findFlightTimeCompletenessError(input: UploadDeliverabilityInput): string | null {
  const rawText = input.rawText ?? '';
  const flightCodes = [...rawText.matchAll(/\b[A-Z]{2}\d{2,4}\b/g)].map(match => match[0]);
  const times = [...rawText.matchAll(/\b\d{1,2}:\d{2}\b/g)].map(match => match[0]);
  if (new Set(flightCodes).size < 2 || times.length < 4) return null;

  const itineraryData = input.itineraryData as { flight_segments?: unknown } | null | undefined;
  const segments = Array.isArray(itineraryData?.flight_segments)
    ? itineraryData.flight_segments as Array<{
      leg?: string | null;
      flight_no?: string | null;
      dep_time?: string | null;
      arr_time?: string | null;
    }>
    : [];
  const outbound = segments.find(segment => segment.leg === 'outbound') ?? segments[0];
  const inbound = segments.find(segment => segment.leg === 'inbound') ?? segments[1];
  if (!outbound || !inbound) {
    return 'source has round-trip flight times but itinerary_data.flight_segments is missing outbound/inbound segments';
  }
  if (!outbound.dep_time || !outbound.arr_time || !inbound.dep_time || !inbound.arr_time) {
    return [
      `source has round-trip flight times but saved segments are incomplete`,
      `outbound ${outbound.flight_no ?? '?'} ${outbound.dep_time ?? '?'}-${outbound.arr_time ?? '?'}`,
      `inbound ${inbound.flight_no ?? '?'} ${inbound.dep_time ?? '?'}-${inbound.arr_time ?? '?'}`,
    ].join(': ');
  }
  const firstTime = times[0];
  if (outbound.dep_time === firstTime && times.length >= 5) {
    const firstTimeLine = rawText
      .split(/\r?\n/)
      .find(line => line.includes(firstTime)) ?? '';
    if (outbound.flight_no && firstTimeLine.includes(outbound.flight_no) && /출발/.test(firstTimeLine)) return null;
    return `first source time ${firstTime} looks like a meeting time and must not be reused as outbound flight departure`;
  }
  return null;
}

export function evaluateUploadDeliverability(input: UploadDeliverabilityInput): UploadDeliverabilityResult {
  const blockers: string[] = [];
  const destination = input.destination?.trim();
  const destinationCode = input.destinationCode?.trim();
  const internalCode = input.internalCode?.trim();
  const recoveryFailures = input.priceRecoveryFailures ?? [];

  if (input.priceRows.length === 0) {
    blockers.push(`product_prices missing: ${recoveryFailures.join(' | ') || 'no recognized price table'}`);
  }

  if (input.priceDates.length === 0) {
    blockers.push(`price_dates missing: ${recoveryFailures.join(' | ') || 'no recognized departure-date price range'}`);
  }

  const priceShapeError = findPriceShapeError(input);
  if (priceShapeError) {
    blockers.push(`price shape error: ${priceShapeError}`);
  }

  const priceStorageMismatch = findPriceStorageMismatch(input);
  if (priceStorageMismatch) {
    blockers.push(`price storage mismatch: ${priceStorageMismatch}`);
  }

  const missingCustomerSellingPrice = findMissingCustomerSellingPrice(input);
  if (missingCustomerSellingPrice) {
    blockers.push(`customer selling price missing: ${missingCustomerSellingPrice}`);
  }

  if (!destination || destination === 'UNK') {
    blockers.push('destination unresolved: customer render requires a destination before A4/mobile generation.');
  }

  if (!destinationCode || destinationCode === 'UNK' || internalCode?.includes('-UNK-')) {
    blockers.push('destination code unresolved: internal destination code must be resolved before customer render.');
  }

  const days = input.itineraryDays ?? [];
  const dayNumbers = days
    .map(day => day.day ?? day.dayNumber ?? day.day_number)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (days.length === 0) {
    blockers.push('itinerary missing: customer A4/mobile rendering requires itinerary days.');
  }
  if (days.length > 0 && dayNumbers.length !== days.length) {
    blockers.push('itinerary day number missing: every itinerary day must include a day number.');
  }
  if (dayNumbers.length > new Set(dayNumbers).size) {
    blockers.push('itinerary duplicate day number: duplicate day entries must be resolved before render.');
  }
  const orderedDayNumbers = sortedUniqueNumbers(dayNumbers);
  const expectedDayNumbers = Array.from({ length: orderedDayNumbers.length }, (_, index) => index + 1);
  if (
    orderedDayNumbers.length > 0
    && orderedDayNumbers.some((dayNumber, index) => dayNumber !== expectedDayNumbers[index])
  ) {
    blockers.push(`itinerary day sequence error: day numbers must be contiguous from 1. Current ${orderedDayNumbers.join(',')}`);
  }

  if (typeof input.durationDays === 'number' && input.durationDays > 0 && days.length > input.durationDays + 1) {
    blockers.push(`itinerary duration overflow: product duration ${input.durationDays} days but itinerary has ${days.length} days.`);
  }

  const scheduleQualityIssues = findItineraryScheduleQualityIssues(days);
  for (const issue of scheduleQualityIssues.slice(0, 5)) {
    blockers.push(
      `itinerary schedule quality error: DAY${issue.day ?? '?'} "${issue.activity}" — ${issue.reason}`,
    );
  }
  if (scheduleQualityIssues.length > 5) {
    blockers.push(`itinerary schedule quality error: ${scheduleQualityIssues.length - 5} additional polluted schedule activities.`);
  }

  const flightTimeError = findFlightTimeCompletenessError(input);
  if (flightTimeError) {
    blockers.push(`flight time source mismatch: ${flightTimeError}`);
  }

  const rawText = input.rawText ?? '';
  const minPrice = minNetPrice(input.priceRows);
  if (RISK_CONTEXT_RE.test(rawText) && minPrice != null && minPrice < 100000) {
    blockers.push(`optional-tour ticket amount polluted product price: minimum product price candidate is ${minPrice.toLocaleString()} KRW.`);
  }
  const riskyPrices = new Set(extractRiskContextPrices(rawText));
  const pollutedPrice = collectPositivePrices(input).find(price => riskyPrices.has(price));
  if (pollutedPrice != null) {
    blockers.push(`optional/surcharge/cancellation amount polluted product price: ${pollutedPrice.toLocaleString()} KRW also appears in risk-context text.`);
  }

  for (const failure of input.extraFailures ?? []) {
    blockers.push(failure);
  }

  return {
    ok: blockers.length === 0,
    blockers,
  };
}
