import type { SupabaseClient } from '@supabase/supabase-js';

import { sha256Hex } from './document-ir';
import { stableJson } from './revision';

export type V5PriceRule = {
  revisionId: string;
  sectionIndex: number;
  variantKey: string;
  componentType: 'base' | 'optional_tour';
  scope: 'specific_departure' | 'date_range' | 'weekday' | 'always';
  specificDate: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  weekday: number | null;
  amount: number;
  currency: string;
  chargeBasis: 'per_person';
  inclusion: 'included' | 'optional';
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
  itemType: 'flight' | 'ferry' | 'ground_transport' | 'attraction' | 'meal' | 'lodging' | 'shopping' | 'optional_tour' | 'free_time' | 'meeting' | 'note' | 'unknown';
  startTime: string | null;
  timezone: string | null;
  title: string;
  description: string | null;
  canonicalId: string | null;
  sourceFieldPath: string;
  evidenceRef: Record<string, unknown>;
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
  if (type === 'shopping') return 'shopping';
  if (type === 'option' || type === 'optional_tour') return 'optional_tour';
  if (type === 'free_time') return 'free_time';
  if (type === 'meeting') return 'meeting';
  if (type === 'notice' || type === 'note') return 'note';
  return 'unknown';
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
          sourceFieldPath,
          evidenceRef: evidence,
          ruleHash: sha256Hex(stableJson({ variantKey, componentType: 'base', scope, date, range, weekday, amount, currency, sourceFieldPath })),
        });
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
            canonicalId: asString(event.canonical_id),
            sourceFieldPath,
            evidenceRef: evidenceRef(event.evidence, { fieldPath: sourceFieldPath }),
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
  const priceRules = buildV5PriceRules({ revisionId: input.revisionId, canonicalPayload: input.canonicalPayload });
  const itineraryItems = buildV5ItineraryItems({ revisionId: input.revisionId, canonicalPayload: input.canonicalPayload });
  const { data: existingPriceRules, error: existingPriceError } = await input.supabase
    .from('product_registration_v5_price_rules')
    .select('rule_hash')
    .eq('revision_id', input.revisionId);
  if (existingPriceError) throw existingPriceError;
  const existingRuleHashes = new Set((existingPriceRules ?? []).map(row => String((row as { rule_hash: string }).rule_hash)));
  const missingPriceRules = priceRules.filter(rule => !existingRuleHashes.has(rule.ruleHash));
  if (missingPriceRules.length > 0) {
    const { error } = await input.supabase.from('product_registration_v5_price_rules').insert(missingPriceRules.map(rule => ({
      revision_id: rule.revisionId,
      section_index: rule.sectionIndex,
      variant_key: rule.variantKey,
      component_type: rule.componentType,
      scope: rule.scope,
      specific_date: rule.specificDate,
      effective_start: rule.effectiveStart,
      effective_end: rule.effectiveEnd,
      weekday: rule.weekday,
      amount: rule.amount,
      currency: rule.currency,
      charge_basis: rule.chargeBasis,
      inclusion: rule.inclusion,
      source_field_path: rule.sourceFieldPath,
      evidence_ref: rule.evidenceRef,
      rule_hash: rule.ruleHash,
    })));
    if (error) throw error;
  }
  const { data: existingItineraryItems, error: existingItineraryError } = await input.supabase
    .from('product_registration_v5_itinerary_items')
    .select('item_hash')
    .eq('revision_id', input.revisionId);
  if (existingItineraryError) throw existingItineraryError;
  const existingItemHashes = new Set((existingItineraryItems ?? []).map(row => String((row as { item_hash: string }).item_hash)));
  const missingItineraryItems = itineraryItems.filter(item => !existingItemHashes.has(item.itemHash));
  if (missingItineraryItems.length > 0) {
    const { error } = await input.supabase.from('product_registration_v5_itinerary_items').insert(missingItineraryItems.map(item => ({
      revision_id: item.revisionId,
      section_index: item.sectionIndex,
      variant_key: item.variantKey,
      day_index: item.dayIndex,
      sequence_no: item.sequenceNo,
      item_type: item.itemType,
      start_time: item.startTime,
      timezone: item.timezone,
      title: item.title,
      description: item.description,
      canonical_id: item.canonicalId,
      source_field_path: item.sourceFieldPath,
      evidence_ref: item.evidenceRef,
      item_hash: item.itemHash,
    })));
    if (error) throw error;
  }
  return { priceRuleCount: priceRules.length, itineraryItemCount: itineraryItems.length };
}
