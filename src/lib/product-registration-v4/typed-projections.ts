import type { SupabaseClient } from '@supabase/supabase-js';

import { sha256Hex } from './document-ir';
import { stableJson } from './revision';

export type V5PriceRule = {
  revisionId: string;
  sectionIndex: number;
  variantKey: string;
  componentType: 'base' | 'child' | 'infant' | 'optional_tour';
  scope: 'specific_departure' | 'date_range' | 'weekday' | 'always';
  specificDate: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  weekday: number | null;
  amount: number;
  currency: string;
  chargeBasis: 'per_person';
  inclusion: 'included' | 'optional';
  listAmount: number | null;
  minTravelers: number | null;
  maxTravelers: number | null;
  priceRelation: 'final_sale' | 'standard_sale' | null;
  sourceFieldPath: string;
  evidenceRef: Record<string, unknown>;
  ruleHash: string;
};

export type V5ItineraryItem = {
  revisionId: string;
  sectionIndex: number;
  variantKey: string;
  dayIndex: number;
  sequenceNo: number;
  itemType: 'flight' | 'ferry' | 'ground_transport' | 'attraction' | 'meal' | 'lodging' | 'hotel_checkin' | 'rest' | 'shopping' | 'optional_tour' | 'free_time' | 'meeting' | 'notice' | 'terms' | 'note' | 'unknown';
  startTime: string | null;
  timezone: string | null;
  title: string;
  description: string | null;
  canonicalId: string | null;
  sourceFieldPath: string;
  evidenceRef: Record<string, unknown>;
  factState: 'CONFIRMED' | 'SOURCE_DECLARED_PENDING' | 'MISSING' | 'CONFLICTING' | 'INFERRED_UNSUPPORTED';
  customerTextOrigin: 'STANDARD_RENDERER' | 'APPROVED_TEMPLATE';
  itemHash: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeItemType(value: unknown): V5ItineraryItem['itemType'] {
  const type = String(value ?? '').toLowerCase();
  if (type === 'flight') return 'flight';
  if (type === 'ferry' || type === 'cruise') return 'ferry';
  if (['transfer', 'ground_transport', 'bus', 'rail'].includes(type)) return 'ground_transport';
  if (type === 'attraction' || type === 'activity') return 'attraction';
  if (type === 'meal') return 'meal';
  if (type === 'hotel' || type === 'lodging' || type === 'hotel_stay') return 'lodging';
  if (type === 'hotel_checkin' || type === 'checkin') return 'hotel_checkin';
  if (type === 'rest') return 'rest';
  if (type === 'shopping') return 'shopping';
  if (type === 'option' || type === 'optional_tour') return 'optional_tour';
  if (type === 'free_time') return 'free_time';
  if (type === 'meeting') return 'meeting';
  if (type === 'notice') return 'notice';
  if (type === 'terms') return 'terms';
  if (type === 'note') return 'note';
  return 'unknown';
}

function itineraryFactState(input: {
  itemType: V5ItineraryItem['itemType'];
  title: string;
  canonicalId: string | null;
}): V5ItineraryItem['factState'] {
  if (input.itemType === 'attraction' && !input.canonicalId) return 'MISSING';
  if (input.itemType === 'unknown') return 'MISSING';
  if (['lodging', 'hotel_checkin'].includes(input.itemType)
    && /(?:미정|추후\s*확정|출발\s*전\s*확정|예정|또는\s*동급|동급)/u.test(input.title)) {
    return 'SOURCE_DECLARED_PENDING';
  }
  return 'CONFIRMED';
}

function evidenceRef(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return asObject(value) ?? fallback;
}

function dateRange(value: unknown): { start: string; end: string } | null {
  const range = asObject(value);
  const start = asString(range?.start);
  const end = asString(range?.end);
  return start && end ? { start, end } : null;
}

function singleWeekday(value: unknown, label: unknown): number | null {
  const explicit = asNumber(value);
  if (explicit !== null && explicit >= 0 && explicit <= 6) return Math.trunc(explicit);
  const normalized = asString(label) ?? '';
  const matches = normalized.match(/[일월화수목금토](?=요일|[^가-힣]|$)/g) ?? [];
  if (matches.length !== 1) return null;
  return ['일', '월', '화', '수', '목', '금', '토'].indexOf(matches[0]);
}

export function buildV5PriceRules(input: {
  revisionId: string;
  canonicalPayload: Record<string, unknown>;
}): V5PriceRule[] {
  const rules: V5PriceRule[] = [];
  asArray(input.canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const section = asObject(rawSection);
    const v3 = asObject(section?.v3);
    const ledger = asObject(v3?.ledger);
    asArray(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const variant = asObject(rawVariant);
      const variantKey = asString(variant?.variant_key) ?? `section-${sectionIndex}-variant-${variantIndex}`;
      asArray(variant?.price_calendar).forEach((rawPrice, priceIndex) => {
        const price = asObject(rawPrice);
        const amount = asNumber(price?.amount);
        if (amount === null || amount < 0) return;
        const currency = asString(price?.currency) ?? 'KRW';
        const date = asString(price?.date);
        const range = dateRange(price?.date_range);
        const weekday = singleWeekday(price?.weekday, price?.label);
        const scope: V5PriceRule['scope'] = date
          ? 'specific_departure'
          : range
            ? 'date_range'
            : weekday !== null
              ? 'weekday'
              : 'always';
        const sourceFieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].price_calendar[${priceIndex}]`;
        const evidence = evidenceRef(price?.evidence, { fieldPath: sourceFieldPath });
        const listAmount = asNumber(price?.list_price);
        const minTravelers = asNumber(price?.min_travelers);
        const maxTravelers = asNumber(price?.max_travelers);
        const priceRelation = ['final_sale', 'standard_sale'].includes(String(price?.price_relation))
          ? String(price?.price_relation) as V5PriceRule['priceRelation']
          : null;
        const commercialScope = {
          list_amount: listAmount,
          min_travelers: minTravelers,
          max_travelers: maxTravelers,
          price_relation: priceRelation,
        };
        rules.push({
          revisionId: input.revisionId,
          sectionIndex,
          variantKey,
          componentType: 'base',
          scope,
          specificDate: date,
          effectiveStart: range?.start ?? null,
          effectiveEnd: range?.end ?? null,
          weekday,
          amount,
          currency,
          chargeBasis: 'per_person',
          inclusion: 'included',
          listAmount,
          minTravelers,
          maxTravelers,
          priceRelation,
          sourceFieldPath,
          evidenceRef: { ...evidence, commercial_scope: commercialScope },
          ruleHash: sha256Hex(stableJson({ variantKey, componentType: 'base', scope, date, range, weekday, amount, currency, commercialScope, sourceFieldPath })),
        });
        const passengerPrices = asArray(price?.passenger_prices);
        if (passengerPrices.length > 0) {
          passengerPrices.forEach((rawPassengerPrice, passengerPriceIndex) => {
            const passengerPrice = asObject(rawPassengerPrice);
            const passengerType = asString(passengerPrice?.passenger_type);
            const passengerAmount = asNumber(passengerPrice?.amount);
            if (!['child', 'infant'].includes(passengerType ?? '') || passengerAmount === null || passengerAmount < 0) return;
            const componentType = passengerType as 'child' | 'infant';
            const occupancyType = ['with_bed', 'without_bed'].includes(String(passengerPrice?.occupancy_type))
              ? String(passengerPrice?.occupancy_type)
              : null;
            const passengerSourceFieldPath = `${sourceFieldPath}.passenger_prices[${passengerPriceIndex}]`;
            const passengerEvidence = evidenceRef(passengerPrice?.evidence, { fieldPath: passengerSourceFieldPath });
            const passengerCurrency = asString(passengerPrice?.currency) ?? currency;
            rules.push({
              revisionId: input.revisionId,
              sectionIndex,
              variantKey,
              componentType,
              scope,
              specificDate: date,
              effectiveStart: range?.start ?? null,
              effectiveEnd: range?.end ?? null,
              weekday,
              amount: passengerAmount,
              currency: passengerCurrency,
              chargeBasis: 'per_person',
              inclusion: 'included',
              listAmount: null,
              minTravelers,
              maxTravelers,
              priceRelation: null,
              sourceFieldPath: passengerSourceFieldPath,
              evidenceRef: {
                ...passengerEvidence,
                passenger_type: componentType,
                occupancy_type: occupancyType,
                passenger_label: asString(passengerPrice?.label),
                derived_policy: 'source',
              },
              ruleHash: sha256Hex(stableJson({
                variantKey,
                componentType,
                occupancyType,
                scope,
                date,
                range,
                weekday,
                amount: passengerAmount,
                currency: passengerCurrency,
                sourceFieldPath: passengerSourceFieldPath,
              })),
            });
          });
          return;
        }
        const childAmount = asNumber(price?.child_amount) ?? amount;
        const childBasis = asString(price?.child_price_basis) ?? 'same_as_adult_policy';
        rules.push({
          revisionId: input.revisionId,
          sectionIndex,
          variantKey,
          componentType: 'child',
          scope,
          specificDate: date,
          effectiveStart: range?.start ?? null,
          effectiveEnd: range?.end ?? null,
          weekday,
          amount: childAmount,
          currency,
          chargeBasis: 'per_person',
          inclusion: 'included',
          listAmount: null,
          minTravelers,
          maxTravelers,
          priceRelation: null,
          sourceFieldPath: `${sourceFieldPath}.child_amount`,
          evidenceRef: {
            ...evidence,
            derived_policy: childBasis,
            derived_from_adult_amount: childBasis === 'same_as_adult_policy',
          },
          ruleHash: sha256Hex(stableJson({ variantKey, componentType: 'child', scope, date, range, weekday, amount: childAmount, currency, childBasis, sourceFieldPath })),
        });
        const infantAmount = asNumber(price?.infant_amount);
        if (infantAmount !== null && infantAmount >= 0) {
          rules.push({
            revisionId: input.revisionId,
            sectionIndex,
            variantKey,
            componentType: 'infant',
            scope,
            specificDate: date,
            effectiveStart: range?.start ?? null,
            effectiveEnd: range?.end ?? null,
            weekday,
            amount: infantAmount,
            currency,
            chargeBasis: 'per_person',
            inclusion: 'included',
            listAmount: null,
            minTravelers,
            maxTravelers,
            priceRelation: null,
            sourceFieldPath: `${sourceFieldPath}.infant_amount`,
            evidenceRef: { ...evidence, derived_policy: 'source' },
            ruleHash: sha256Hex(stableJson({ variantKey, componentType: 'infant', scope, date, range, weekday, amount: infantAmount, currency, sourceFieldPath })),
          });
        }
      });
      asArray(variant?.options).forEach((rawOption, optionIndex) => {
        const option = asObject(rawOption);
        const amount = asNumber(option?.price_amount);
        if (amount === null || amount < 0) return;
        const sourceFieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].options[${optionIndex}]`;
        rules.push({
          revisionId: input.revisionId,
          sectionIndex,
          variantKey,
          componentType: 'optional_tour',
          scope: 'always',
          specificDate: null,
          effectiveStart: null,
          effectiveEnd: null,
          weekday: null,
          amount,
          currency: asString(option?.currency) ?? 'KRW',
          chargeBasis: 'per_person',
          inclusion: 'optional',
          listAmount: null,
          minTravelers: null,
          maxTravelers: null,
          priceRelation: null,
          sourceFieldPath,
          evidenceRef: evidenceRef(option?.evidence, { fieldPath: sourceFieldPath }),
          ruleHash: sha256Hex(stableJson({ variantKey, componentType: 'optional_tour', amount, sourceFieldPath })),
        });
      });
    });
  });
  return rules;
}

export function buildV5ItineraryItems(input: {
  revisionId: string;
  canonicalPayload: Record<string, unknown>;
}): V5ItineraryItem[] {
  const items: V5ItineraryItem[] = [];
  asArray(input.canonicalPayload.sections).forEach((rawSection, sectionIndex) => {
    const section = asObject(rawSection);
    const v3 = asObject(section?.v3);
    const ledger = asObject(v3?.ledger);
    asArray(ledger?.variants).forEach((rawVariant, variantIndex) => {
      const variant = asObject(rawVariant);
      const variantKey = asString(variant?.variant_key) ?? `section-${sectionIndex}-variant-${variantIndex}`;
      asArray(variant?.days).forEach((rawDay, dayIndex) => {
        const day = asObject(rawDay);
        const dayNumber = asNumber(day?.day) ?? dayIndex + 1;
        asArray(day?.events).forEach((rawEvent, sequenceNo) => {
          const event = asObject(rawEvent);
          if (!event) return;
          const sourceFieldPath = `sections[${sectionIndex}].v3.ledger.variants[${variantIndex}].days[${dayIndex}].events[${sequenceNo}]`;
          const title = asString(event.raw_text) ?? asString(event.title) ?? asString(event.activity);
          if (!title) return;
          const itemType = normalizeItemType(event.type ?? event.entity_kind);
          const canonicalId = asString(event.canonical_id);
          const factState = itineraryFactState({ itemType, title, canonicalId });
          const sourceEvidence = evidenceRef(event.evidence, { fieldPath: sourceFieldPath });
          const item = {
            revisionId: input.revisionId,
            sectionIndex,
            variantKey,
            dayIndex: Math.max(1, Math.trunc(dayNumber)),
            sequenceNo,
            itemType,
            startTime: asString(event.time),
            timezone: asString(event.timezone),
            title,
            description: asString(event.description),
            canonicalId,
            sourceFieldPath,
            evidenceRef: {
              ...sourceEvidence,
              v61: { fact_state: factState, customer_text_origin: 'STANDARD_RENDERER' },
            },
            factState,
            customerTextOrigin: 'STANDARD_RENDERER' as const,
            itemHash: '',
          } satisfies Omit<V5ItineraryItem, 'itemHash'> & { itemHash: string };
          item.itemHash = sha256Hex(stableJson({ ...item, itemHash: undefined }));
          items.push(item);
        });
      });
    });
  });
  return items;
}

export async function persistV5TypedProjections(input: {
  supabase: SupabaseClient;
  revisionId: string;
  canonicalPayload: Record<string, unknown>;
}): Promise<{ priceRuleCount: number; itineraryItemCount: number }> {
  void input;
  throw new Error('V5_TYPED_PROJECTION_WRITER_RETIRED_USE_COMMIT_REVISION_ATOMIC');
}
