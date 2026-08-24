import type { SupabaseClient } from '@supabase/supabase-js';

import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { stableJson } from '@/lib/product-registration-v4/revision';

type JsonObject = Record<string, unknown>;

export type ProductRegistrationV6DomainProjection = {
  departures: JsonObject[];
  transportSegments: JsonObject[];
  lodgingStays: JsonObject[];
  golfRounds: JsonObject[];
  entityRelations?: JsonObject[];
};

export type DeparturePricingState = 'PRICED' | 'REQUEST_ONLY' | 'CONFLICTING' | 'MISSING' | 'UNRESOLVED';
export type DepartureBookingState = 'AVAILABLE' | 'MANUAL_CONFIRMATION_REQUIRED' | 'SALES_CLOSED' | 'SOLD_OUT' | 'CANCELLED' | 'UNKNOWN';
export type DepartureInventoryState = 'AVAILABLE' | 'ON_REQUEST' | 'SOLD_OUT' | 'CLOSED' | 'UNKNOWN';

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const clean = value.replace(/[₩원\s]/gu, '');
  if (clean.includes(',') && !/^\d{1,3}(,\d{3})+$/u.test(clean)) return null;
  const normalized = clean.replace(/,/gu, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rawAmount(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function labels(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim())
    : [];
}

function hasRequestLabel(price: JsonObject): boolean {
  const haystack = [
    text(price.label),
    text(price.note),
    text(price.booking_state),
    ...labels(price.source_labels),
  ].filter(Boolean).join(' ');
  return /별도\s*문의|문의\s*(?:필요|필수)|예약\s*문의|request|on\s*request/iu.test(haystack);
}

function hasClosedLabel(price: JsonObject): boolean {
  const haystack = [
    text(price.label),
    text(price.note),
    text(price.booking_state),
    text(price.inventory_state),
    ...labels(price.source_labels),
  ].filter(Boolean).join(' ');
  return /미운항|운항\s*없음|판매\s*마감|예약\s*마감|closed|sold\s*out|cancel/iu.test(haystack);
}

function bookingState(price: JsonObject, requestOnly: boolean, closed: boolean): DepartureBookingState {
  const explicit = text(price.booking_state)?.toUpperCase();
  if (explicit === 'SOLD_OUT') return 'SOLD_OUT';
  if (explicit === 'CANCELLED') return 'CANCELLED';
  if (explicit === 'SALES_CLOSED' || closed) return 'SALES_CLOSED';
  if (explicit === 'AVAILABLE' && !requestOnly) return 'AVAILABLE';
  if (requestOnly) return 'MANUAL_CONFIRMATION_REQUIRED';
  return 'UNKNOWN';
}

function inventoryState(price: JsonObject, booking: DepartureBookingState): DepartureInventoryState {
  const explicit = text(price.inventory_state)?.toUpperCase();
  if (explicit === 'AVAILABLE') return 'AVAILABLE';
  if (explicit === 'ON_REQUEST') return 'ON_REQUEST';
  if (explicit === 'SOLD_OUT') return 'SOLD_OUT';
  if (explicit === 'CLOSED') return 'CLOSED';
  if (booking === 'SOLD_OUT') return 'SOLD_OUT';
  if (booking === 'SALES_CLOSED' || booking === 'CANCELLED') return 'CLOSED';
  if (booking === 'MANUAL_CONFIRMATION_REQUIRED') return 'ON_REQUEST';
  return 'UNKNOWN';
}

function departurePricing(price: JsonObject, fieldPath: string): JsonObject {
  const raw = rawAmount(price.amount ?? price.adult_selling_price);
  const amount = number(price.amount ?? price.adult_selling_price);
  const requestOnly = hasRequestLabel(price);
  const closed = hasClosedLabel(price);
  const booking = bookingState(price, requestOnly, closed);
  const pricingState: DeparturePricingState = amount !== null
    ? 'PRICED'
    : raw
      ? 'CONFLICTING'
      : requestOnly
        ? 'REQUEST_ONLY'
        : 'MISSING';
  const ruleType = text(price.rule_type)
    ?? (text(price.date) ? 'EXACT_DATE_OVERRIDE' : text(price.date_range) ? 'DATE_RANGE_RULE' : 'WEEKDAY_RULE');
  const ruleHash = sha256Hex(stableJson({ fieldPath, ruleType, raw, amount, currency: text(price.currency) ?? 'KRW' }));
  return {
    source_field_path: fieldPath,
    adult_selling_price: amount,
    child_selling_price: number(price.child_amount ?? price.child_selling_price),
    currency: (text(price.currency) ?? 'KRW').toUpperCase(),
    raw_amount: raw,
    pricing_state: pricingState,
    booking_state: booking,
    inventory_state: inventoryState(price, booking),
    price_rule_type: ruleType,
    price_rule_hash: ruleHash,
    price_override_key: text(price.date) ? `${fieldPath}:${text(price.date)}` : null,
    source_labels: labels(price.source_labels),
    source_ref_ids: labels(price.source_ref_ids),
    source_confidence: number(price.source_confidence),
    price_revision: text(price.price_revision),
    sale_state: booking === 'AVAILABLE'
      ? 'available'
      : booking === 'MANUAL_CONFIRMATION_REQUIRED'
        ? 'request'
        : booking === 'SOLD_OUT'
          ? 'sold_out'
          : booking === 'CANCELLED'
            ? 'cancelled'
            : 'closed',
  };
}

function time(value: unknown): string | null {
  const match = text(value)?.match(/\b([01]?\d|2[0-3]):?([0-5]\d)\b/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

function evidence(value: unknown, fieldPath: string): unknown[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [{ field_path: fieldPath }];
}

function mergeEvidence(existing: unknown, incoming: unknown): unknown[] {
  const rows = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    ...(Array.isArray(incoming) ? incoming : incoming ? [incoming] : []),
  ];
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function flightIdentity(value: unknown): { carrierCode: string | null; serviceNumber: string | null } {
  const serviceNumber = text(value)?.replace(/\s+/g, '').toUpperCase() ?? null;
  return {
    serviceNumber,
    carrierCode: serviceNumber?.match(/^([A-Z0-9]{2})(?=\d)/)?.[1] ?? null,
  };
}

export function classifyLodgingState(value: unknown): 'confirmed' | 'equivalent' | 'to_be_confirmed' {
  const lodgingName = text(value) ?? '';
  if (/미정|추후\s*확정|해당\s*(?:숙소|호텔)|예정\s*(?:숙소|호텔)/i.test(lodgingName)) {
    return 'to_be_confirmed';
  }
  return /동급|또는/i.test(lodgingName) ? 'equivalent' : 'confirmed';
}

export function buildProductRegistrationV6DomainProjection(input: {
  canonicalPayload: JsonObject;
  packageId?: string | null;
}): ProductRegistrationV6DomainProjection {
  const projection: ProductRegistrationV6DomainProjection = {
    departures: [],
    transportSegments: [],
    lodgingStays: [],
    golfRounds: [],
    entityRelations: [],
  };
  array(input.canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const ledger = object(object(object(rawSection)?.v3)?.ledger);
    array(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const variant = object(rawVariant) ?? {};
      const variantKey = text(variant.variant_key) ?? `section-${sectionIndex}-variant-${variantIndex}`;
      array(variant.price_calendar).forEach((rawPrice, priceIndex) => {
        const price = object(rawPrice);
        const departureDate = text(price?.date);
        if (!departureDate || !/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) return;
        const fieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].price_calendar[${priceIndex}]`;
        const pricingFact = departurePricing(price ?? {}, fieldPath);
        const departure = {
          package_id: input.packageId ?? null,
          section_index: sectionIndex,
          variant_key: variantKey,
          departure_date: departureDate,
          ...pricingFact,
          evidence: evidence(price?.evidence, fieldPath),
        };
        // A source table can repeat a date while presenting the same fare in
        // multiple rows (for example, a hotel/meal note beside the fare).
        // The relational projection is unique by revision/section/variant/date;
        // collapse only that projection duplicate and retain every evidence
        // anchor. Price ambiguity is still resolved and gated before this step.
        const existing = projection.departures.find(row =>
          row.section_index === sectionIndex
          && row.variant_key === variantKey
          && row.departure_date === departureDate,
        );
        if (existing) {
          existing.evidence = mergeEvidence(existing.evidence, departure.evidence);
          if (existing.pricing_state !== pricingFact.pricing_state
            || existing.adult_selling_price !== pricingFact.adult_selling_price
            || existing.booking_state !== pricingFact.booking_state) {
            existing.pricing_state = 'CONFLICTING';
            existing.booking_state = 'MANUAL_CONFIRMATION_REQUIRED';
            existing.sale_state = 'request';
          }
        } else {
          projection.departures.push(departure);
        }
      });
      array(variant.flight_segments).forEach((rawSegment, sequenceNo) => {
        const segment = object(rawSegment) ?? {};
        const fieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].flight_segments[${sequenceNo}]`;
        const identity = flightIdentity(segment.code ?? segment.flight_no);
        const departureLocalTime = time(segment.dep_time ?? segment.departure_time);
        const arrivalLocalTime = time(segment.arr_time ?? segment.arrival_time);
        projection.transportSegments.push({
          package_id: input.packageId ?? null,
          section_index: sectionIndex,
          variant_key: variantKey,
          sequence_no: sequenceNo,
          transport_type: 'flight',
          leg: ['outbound', 'inbound', 'intermediate'].includes(String(segment.leg)) ? segment.leg : 'unknown',
          carrier_code: identity.carrierCode,
          service_number: identity.serviceNumber,
          departure_place_code: text(segment.dep_airport ?? segment.departure_airport),
          arrival_place_code: text(segment.arr_airport ?? segment.arrival_airport),
          departure_local_time: departureLocalTime,
          arrival_local_time: arrivalLocalTime,
          arrival_day_offset: Number.isInteger(segment.arr_day_offset) ? Number(segment.arr_day_offset) : 0,
          departure_timezone: text(segment.departure_timezone),
          arrival_timezone: text(segment.arrival_timezone),
          fact_state: departureLocalTime && arrivalLocalTime ? 'source_confirmed' : 'degraded',
          source_field_path: fieldPath,
          evidence: evidence(segment.evidence, fieldPath),
        });
      });
      array(variant.days).forEach((rawDay, dayOffset) => {
        const day = object(rawDay) ?? {};
        const dayIndex = Math.max(1, Number(day.day ?? dayOffset + 1));
        const hotel = object(day.hotel);
        const lodgingName = text(hotel?.name ?? hotel?.raw_text);
        if (lodgingName) {
          const fieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].days[${dayOffset}].hotel`;
          projection.lodgingStays.push({
            package_id: input.packageId ?? null,
            section_index: sectionIndex,
            variant_key: variantKey,
            day_index: dayIndex,
            nights: 1,
            lodging_name: lodgingName,
            lodging_state: classifyLodgingState(lodgingName),
            canonical_entity_id: text(hotel?.canonical_entity_id),
            entity_revision_id: text(hotel?.entity_revision_id),
            source_field_path: fieldPath,
            evidence: evidence(hotel?.evidence, fieldPath),
          });
        }
        array(day.events).forEach((rawEvent, eventIndex) => {
          const event = object(rawEvent) ?? {};
          const rawName = text(event.raw_text ?? event.title);
          if (!rawName || !/(?:골프|golf|\bC\.?C\.?\b|\bG\.?C\.?\b)/i.test(rawName)) return;
          if (/선택|옵션|추가\s*비용/i.test(rawName) || ['option', 'optional_tour'].includes(String(event.type))) return;
          const holes = Number(rawName.match(/(\d{1,2})\s*홀/)?.[1] ?? NaN);
          projection.golfRounds.push({
            package_id: input.packageId ?? null,
            section_index: sectionIndex,
            variant_key: variantKey,
            day_index: dayIndex,
            course_name_raw: rawName,
            canonical_entity_id: text(event.canonical_entity_id),
            entity_revision_id: text(event.entity_revision_id),
            tee_time: time(event.time),
            holes: Number.isFinite(holes) ? holes : null,
            green_fee_inclusion: null,
            caddie_inclusion: null,
            cart_inclusion: null,
            evidence: evidence(event.evidence, `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].days[${dayOffset}].events[${eventIndex}]`),
          });
        });
      });
    });
  });
  return projection;
}

export async function persistProductRegistrationV6DomainProjection(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
  revisionId: string;
  revisionHash: string;
  sourceHash: string;
  projection: ProductRegistrationV6DomainProjection;
}) {
  const { data, error } = await input.supabase.rpc('persist_product_registration_v6_domain_projection', {
    p_payload: {
      tenant_id: input.tenantId,
      revision_id: input.revisionId,
      revision_hash: input.revisionHash,
      source_hash: input.sourceHash,
      departures: input.projection.departures,
      transport_segments: input.projection.transportSegments,
      lodging_stays: input.projection.lodgingStays,
      golf_rounds: input.projection.golfRounds,
    },
  });
  if (error) throw error;
  return data;
}
