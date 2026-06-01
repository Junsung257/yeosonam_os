import { findEvidenceSpan, hashRawText, type SourceEvidenceMap } from '@/lib/source-evidence';
import type { ProductRegistrationV2ExecutedProduct } from './types';

function addEvidence(map: SourceEvidenceMap, rawText: string, field: string, value: unknown): void {
  const span = findEvidenceSpan(rawText, value, { rawTextHash: hashRawText(rawText) });
  if (span) map[field] = [span];
}

function compactIncludes(rawText: string, value: string): boolean {
  const compactRaw = rawText.replace(/\s+/g, '');
  const compactValue = value.replace(/\s+/g, '');
  return compactValue.length >= 2 && compactRaw.includes(compactValue);
}

function addCompactEvidence(map: SourceEvidenceMap, rawText: string, field: string, value: string): void {
  const direct = findEvidenceSpan(rawText, value, { rawTextHash: hashRawText(rawText) });
  if (direct) {
    map[field] = [direct];
    return;
  }
  if (!compactIncludes(rawText, value)) return;
  map[field] = [{
    rawTextHash: hashRawText(rawText),
    start: 0,
    end: rawText.length,
    quote: value,
    confidence: 0.85,
    source: 'deterministic',
  }];
}

export const REQUIRED_V2_CUSTOMER_EVIDENCE_FIELDS = [
  'title',
  'min_participants',
  'price_dates',
  'flight.outbound.code',
  'flight.outbound.dep_time',
  'flight.outbound.arr_time',
  'flight.inbound.code',
  'flight.inbound.dep_time',
  'flight.inbound.arr_time',
  'inclusions',
  'excludes',
  'hotel',
  'shopping',
  'itinerary',
] as const;

export function buildProductEvidenceV2(product: Omit<ProductRegistrationV2ExecutedProduct, 'sourceEvidence'>): SourceEvidenceMap {
  const rawText = product.section_raw_text;
  const ed = product.extractedData;
  const map: SourceEvidenceMap = {};

  addCompactEvidence(map, rawText, 'title', ed.title ?? '');
  addEvidence(map, rawText, 'min_participants', ed.min_participants);

  const priceDates = product.renderInput.price_dates ?? [];
  const firstPrice = priceDates.find(p => p.price > 0);
  if (firstPrice) {
    addEvidence(map, rawText, 'price_dates', firstPrice.price);
  }

  const segments = product.itineraryData.flight_segments ?? [];
  const outbound = segments.find(s => s.leg === 'outbound');
  const inbound = segments.find(s => s.leg === 'inbound');
  if (outbound) {
    addEvidence(map, rawText, 'flight.outbound.code', outbound.flight_no);
    addEvidence(map, rawText, 'flight.outbound.dep_time', outbound.dep_time);
    addEvidence(map, rawText, 'flight.outbound.arr_time', outbound.arr_time);
  }
  if (inbound) {
    addEvidence(map, rawText, 'flight.inbound.code', inbound.flight_no);
    addEvidence(map, rawText, 'flight.inbound.dep_time', inbound.dep_time);
    addEvidence(map, rawText, 'flight.inbound.arr_time', inbound.arr_time);
  }

  for (const [idx, value] of (ed.inclusions ?? []).entries()) addCompactEvidence(map, rawText, `inclusions[${idx}]`, value);
  if ((ed.inclusions ?? []).length > 0) map.inclusions = Object.values(map).flat().filter(span => (ed.inclusions ?? []).some(v => span.quote.includes(v) || compactIncludes(span.quote, v)));

  for (const [idx, value] of (ed.excludes ?? []).entries()) addCompactEvidence(map, rawText, `excludes[${idx}]`, value);
  if ((ed.excludes ?? []).length > 0) map.excludes = Object.entries(map).filter(([k]) => k.startsWith('excludes[')).flatMap(([, v]) => v);

  const hotels = product.itineraryData.days?.map(d => d.hotel?.name).filter((v): v is string => Boolean(v)) ?? [];
  for (const [idx, hotel] of hotels.entries()) addCompactEvidence(map, rawText, `hotel[${idx}]`, hotel);
  if (hotels.length > 0) map.hotel = Object.entries(map).filter(([k]) => k.startsWith('hotel[')).flatMap(([, v]) => v);

  const shopping = product.renderInput.itinerary_data?.highlights?.shopping;
  if (shopping) addCompactEvidence(map, rawText, 'shopping', shopping);

  const scheduleValues = product.itineraryData.days?.flatMap(d => d.schedule ?? []).map(s => s.activity).filter(Boolean) ?? [];
  for (const [idx, activity] of scheduleValues.entries()) addCompactEvidence(map, rawText, `itinerary[${idx}]`, activity ?? '');
  if (scheduleValues.length > 0) map.itinerary = Object.entries(map).filter(([k]) => k.startsWith('itinerary[')).flatMap(([, v]) => v);

  for (const [idx, tour] of (ed.optional_tours ?? []).entries()) {
    addCompactEvidence(map, rawText, `optional_tours[${idx}].name`, tour.name);
    addEvidence(map, rawText, `optional_tours[${idx}].price`, tour.price ?? tour.price_usd);
  }

  return map;
}
