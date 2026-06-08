import type {
  V3DraftLedger,
  V3EntityCategory,
  V3EntityReviewItem,
  V3EntitySummary,
  V3EntitySuggestedAction,
  V3EventType,
  V3LedgerEvent,
} from './types';

export const V3_ENTITY_CATEGORIES: V3EntityCategory[] = [
  'attraction',
  'hotel',
  'meal',
  'transfer',
  'shopping',
  'optional_tour',
  'free_time',
  'notice',
  'price_noise',
  'unknown',
];

function emptyCounts(): Record<V3EntityCategory, number> {
  return Object.fromEntries(V3_ENTITY_CATEGORIES.map(category => [category, 0])) as Record<V3EntityCategory, number>;
}

export function entityCategoryForEventType(type: V3EventType): V3EntityCategory {
  if (type === 'option') return 'optional_tour';
  if (type === 'activity') return 'unknown';
  if (type === 'meeting') return 'transfer';
  return V3_ENTITY_CATEGORIES.includes(type as V3EntityCategory)
    ? type as V3EntityCategory
    : 'unknown';
}

function regionalFoodTerm(rawText: string): string | null {
  const compact = rawText.replace(/\s+/g, '').toLowerCase();
  if (/쌀국수|pho|phở/i.test(rawText)) return 'rice_noodle';
  if (/삼겹살|samgyeopsal/i.test(compact)) return 'samgyeopsal';
  if (/현지식|localmeal|localfood/i.test(compact)) return 'local_meal';
  if (/호텔식|hotelmeal|hotelbreakfast/i.test(compact)) return 'hotel_meal';
  return null;
}

function confidenceFor(category: V3EntityCategory, event: V3LedgerEvent): number {
  if (category === 'attraction') return event.match_status === 'matched' ? 0.95 : 0.6;
  if (category === 'meal' || category === 'transfer' || category === 'free_time' || category === 'price_noise') return 0.9;
  if (category === 'hotel') return 0.78;
  if (category === 'shopping' || category === 'optional_tour' || category === 'notice') return 0.72;
  return 0.5;
}

function suggestedActionFor(category: V3EntityCategory, event: V3LedgerEvent): V3EntitySuggestedAction {
  if (category === 'attraction') {
    return event.match_status === 'matched' ? 'auto_resolve_existing' : 'needs_review';
  }
  if (category === 'hotel') return 'suggest_alias';
  if (category === 'meal' || category === 'transfer') return 'auto_resolve_existing';
  if (category === 'free_time' || category === 'price_noise') return 'auto_ignore_noise';
  if (category === 'shopping' || category === 'optional_tour' || category === 'notice') return 'needs_review';
  return event.match_status === 'ignored' ? 'auto_ignore_noise' : 'needs_review';
}

function customerVisible(category: V3EntityCategory): boolean {
  return !['price_noise'].includes(category);
}

function blocksPublish(category: V3EntityCategory, event: V3LedgerEvent): boolean {
  if (category === 'attraction') return event.match_status !== 'matched';
  if (category === 'shopping' || category === 'optional_tour' || category === 'notice') return event.match_status === 'review';
  if (category === 'unknown') return event.match_status !== 'ignored' && customerVisible(category);
  return false;
}

function reviewKey(item: V3EntityReviewItem): string {
  return [
    item.category,
    item.raw_text.replace(/\s+/g, ' ').trim().toLowerCase(),
    item.evidence.line_start,
    item.evidence.line_end,
  ].join('|');
}

export function buildEntityReviewItem(input: {
  event: V3LedgerEvent;
  dayNumber: number | null;
  destination?: string | null;
  country?: string | null;
}): V3EntityReviewItem {
  const category = entityCategoryForEventType(input.event.type);
  const foodTerm = category === 'meal' ? regionalFoodTerm(input.event.raw_text) : null;
  const confidence = confidenceFor(category, input.event);
  const suggested_action = suggestedActionFor(category, input.event);
  return {
    raw_text: input.event.raw_text,
    category,
    day_number: input.dayNumber,
    evidence: input.event.evidence,
    confidence,
    suggested_action,
    customer_visible: customerVisible(category),
    blocks_publish: blocksPublish(category, input.event),
    suggested_resolution: {
      category,
      destination_scope: input.destination ?? null,
      country_scope: input.country ?? null,
      global_term: foodTerm,
      match_status: input.event.match_status,
      canonical_id: input.event.canonical_id,
      canonical_type: input.event.canonical_type,
      policy: category === 'attraction'
        ? 'match-existing-only-no-auto-create'
        : 'global-taxonomy-with-regional-scope',
    },
  };
}

export function buildV3EntitySummary(input: {
  ledger: V3DraftLedger;
  destination?: string | null;
  country?: string | null;
}): V3EntitySummary {
  const counts = emptyCounts();
  const reviewItems: V3EntityReviewItem[] = [];
  const seenEntities = new Set<string>();
  const seenReviewItems = new Set<string>();

  const addItem = (item: V3EntityReviewItem) => {
    const key = reviewKey(item);
    if (seenEntities.has(key)) return;
    seenEntities.add(key);
    counts[item.category]++;
    if (item.blocks_publish || item.suggested_action === 'needs_review' || item.suggested_action === 'suggest_alias') {
      if (!seenReviewItems.has(key)) {
        seenReviewItems.add(key);
        reviewItems.push(item);
      }
    }
  };

  for (const variant of input.ledger.variants) {
    for (const day of variant.days) {
      for (const event of day.events) {
        const item = buildEntityReviewItem({
          event,
          dayNumber: day.day,
          destination: input.destination,
          country: input.country,
        });
        addItem(item);
      }
    }

    for (const option of variant.options) {
      const event: V3LedgerEvent = {
        type: 'option',
        time: null,
        raw_text: option.raw_name,
        canonical_id: null,
        canonical_type: 'option',
        match_status: option.match_status,
        evidence: option.evidence,
      };
      const item = buildEntityReviewItem({
        event,
        dayNumber: option.day_number,
        destination: input.destination,
        country: input.country,
      });
      addItem(item);
    }

    for (const shopping of variant.shopping) {
      const event: V3LedgerEvent = {
        type: 'shopping',
        time: null,
        raw_text: shopping.value,
        canonical_id: null,
        canonical_type: 'shopping',
        match_status: 'review',
        evidence: shopping.evidence,
      };
      const item = buildEntityReviewItem({
        event,
        dayNumber: null,
        destination: input.destination,
        country: input.country,
      });
      addItem(item);
    }
  }

  return {
    counts,
    review_required_count: reviewItems.length,
    attraction_unresolved_count: reviewItems.filter(item => item.category === 'attraction' && item.blocks_publish).length,
    shopping_review_needed_count: reviewItems.filter(item => item.category === 'shopping').length,
    option_review_needed_count: reviewItems.filter(item => item.category === 'optional_tour').length,
    unknown_customer_visible_count: reviewItems.filter(item => item.category === 'unknown' && item.customer_visible).length,
    auto_ignored_noise_count: counts.price_noise + counts.free_time,
    meal_structured_count: counts.meal,
    transfer_structured_count: counts.transfer,
    hotel_structured_count: counts.hotel,
    free_time_structured_count: counts.free_time,
    review_items: reviewItems,
  };
}
