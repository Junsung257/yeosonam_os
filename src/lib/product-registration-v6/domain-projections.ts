import type { SupabaseClient } from '@supabase/supabase-js';

type JsonObject = Record<string, unknown>;

export type ProductRegistrationV6DomainProjection = {
  departures: JsonObject[];
  transportSegments: JsonObject[];
  lodgingStays: JsonObject[];
  golfRounds: JsonObject[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function time(value: unknown): string | null {
  const match = text(value)?.match(/\b([01]?\d|2[0-3]):?([0-5]\d)\b/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null;
}

function evidence(value: unknown, fieldPath: string): unknown[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [{ field_path: fieldPath }];
}

function flightIdentity(value: unknown): { carrierCode: string | null; serviceNumber: string | null } {
  const serviceNumber = text(value)?.replace(/\s+/g, '').toUpperCase() ?? null;
  return {
    serviceNumber,
    carrierCode: serviceNumber?.match(/^([A-Z0-9]{2,3})\d/)?.[1] ?? null,
  };
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
        projection.departures.push({
          package_id: input.packageId ?? null,
          section_index: sectionIndex,
          variant_key: variantKey,
          departure_date: departureDate,
          sale_state: 'available',
          evidence: evidence(price?.evidence, fieldPath),
        });
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
            lodging_state: /미정|추후\s*확정/i.test(lodgingName) ? 'to_be_confirmed' : /동급|또는/i.test(lodgingName) ? 'equivalent' : 'confirmed',
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
