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

function normalizeOptionDisclosureText(rawText: string): string {
  return rawText
    .replace(/^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b()]+/, '')
    .replace(/[()]+$/g, '')
    .replace(/^(?:\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\ucd94\ucc9c\uc635\uc158|\uad00\uad11|\ub9c8\uc0ac\uc9c0|\uc2dd\uc0ac)\s*[:：]\s*/i, '')
    .replace(/\$\s*\d+(?:\.\d+)?/g, '')
    .replace(/\s*\/\s*\uc778/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionalEventHasCustomerSafeDisclosure(rawText: string): boolean {
  const compact = rawText
    .replace(/^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b()]+/, '')
    .replace(/[()]+$/g, '')
    .replace(/\s+/g, '');
  if (/^(?:\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\ucd94\ucc9c\uc635\uc158)$/.test(compact)) return true;
  if (/^(?:\uc120\ud0dd\uad00\uad11\ube44\uc6a9|\uc720\ub958\ubcc0\ub3d9\ubd84|\ub9e4\ub108\ud301\ubc0f\uac1c\uc778\uacbd\ube44|\uac1c\uc778\uacbd\ube44)$/.test(compact)) return true;
  if (/^(?:\uae30\uc0ac\/?\uac00\uc774\ub4dc\uacbd\ube44|\uac00\uc774\ub4dc\/?\uae30\uc0ac\uacbd\ube44)\$?\d+/i.test(compact)) return true;
  return /\$\s*\d+(?:\.\d+)?/.test(rawText) && normalizeOptionDisclosureText(rawText).length >= 2;
}

function hasExplicitShoppingCountDisclosure(text: string): boolean {
  return /(?:\uc1fc\ud551|\uba74\uc138\uc810).*\d+\s*(?:\uacf3|\ud68c).*(?:\ubc29\ubb38|\uc608\uc815)|\d+\s*(?:\uacf3|\ud68c).*(?:\uc1fc\ud551|\uba74\uc138\uc810)/.test(text);
}

function shoppingEventHasCustomerSafeDisclosure(rawText: string): boolean {
  if (hasExplicitShoppingCountDisclosure(rawText)) return true;
  return /쇼핑(?:센터)?\s*\d+\s*회|\d+\s*회/.test(rawText)
    && /(침향|한약|라텍스|차가버섯|죽탄|콜라겐|보이차|농산물|잡화|토산품|기념품|면세|노니|커피)/i.test(rawText);
}

function suggestedActionFor(category: V3EntityCategory, event: V3LedgerEvent): V3EntitySuggestedAction {
  if (category === 'attraction') {
    return event.match_status === 'matched' ? 'auto_resolve_existing' : 'needs_review';
  }
  if (category === 'hotel') return 'suggest_alias';
  if (category === 'meal' || category === 'transfer') return 'auto_resolve_existing';
  if (category === 'free_time' || category === 'price_noise') return 'auto_ignore_noise';
  if (category === 'shopping' || category === 'optional_tour') {
    if (category === 'optional_tour' && optionalEventHasCustomerSafeDisclosure(event.raw_text)) return 'auto_resolve_existing';
    if (category === 'shopping' && shoppingEventHasCustomerSafeDisclosure(event.raw_text)) return 'auto_resolve_existing';
    return event.match_status === 'review' ? 'needs_review' : 'auto_resolve_existing';
  }
  if (category === 'notice') return event.match_status === 'review' ? 'needs_review' : 'auto_resolve_existing';
  return event.match_status === 'ignored' ? 'auto_ignore_noise' : 'needs_review';
}

function customerVisible(category: V3EntityCategory): boolean {
  return !['price_noise'].includes(category);
}

const ATTRACTION_REVIEW_PREFIX_RE =
  /^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b'"\u2018\u2019\u201c\u201d]+/;
const GUANGZHOU_DESCRIPTION_WITHOUT_MASTER_RE =
  /^(?:소선이\s*신선을\s*만난\s*곳|붉은\s*사암지형의\s*장엄한\s*파노라마\s*뷰)/;
const KOREAN_ATTRACTION_REVIEW_SUFFIX_RE =
  /([가-힣][가-힣\s]{1,18}?(?:풍경구|대협곡|고촌|유후거리|구룡수채|동천선경|봉림소진|대불사|소선령|백록동|삼절비|소선관|만복산|장로봉|양원석|음원석|고의령|마황구|단하산|망산|소동강|비천산|산|강|봉|석|동|비|사|관|령|촌|진|채|곡|거리))(?:\s*\([^)]*\))?$/;
const GUANGZHOU_ATTRACTION_LABELS = [
  '마황구대협곡',
  '와요평고촌',
  '구룡수채',
  '동천선경',
  '봉림소진',
  '유후거리',
  '소선령',
  '백록동',
  '삼절비',
  '소선관',
  '만복산',
  '장로봉',
  '양원석',
  '음원석',
  '고의령',
  '단하산',
  '소동강',
  '비천산',
  '망산',
  '대불사',
];

function normalizeAttractionReviewText(rawText: string): string | null {
  const cleaned = rawText
    .replace(ATTRACTION_REVIEW_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (GUANGZHOU_DESCRIPTION_WITHOUT_MASTER_RE.test(cleaned)) return null;

  const withoutTrailingParen = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const compact = withoutTrailingParen.replace(/\s+/g, '');
  const knownLabel = GUANGZHOU_ATTRACTION_LABELS
    .map(label => ({ label, index: compact.lastIndexOf(label) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => b.index - a.index || b.label.length - a.label.length)[0]?.label;
  if (knownLabel) return knownLabel;

  const suffix = withoutTrailingParen.match(KOREAN_ATTRACTION_REVIEW_SUFFIX_RE)?.[1];
  if (suffix) {
    return suffix.replace(/\s+/g, '').trim();
  }
  if (/^[가-힣]\s+[가-힣]$/.test(cleaned)) return cleaned.replace(/\s+/g, '');
  return cleaned;
}

function blocksPublish(category: V3EntityCategory, event: V3LedgerEvent): boolean {
  if (category === 'attraction') return event.match_status !== 'matched';
  if (category === 'optional_tour' && optionalEventHasCustomerSafeDisclosure(event.raw_text)) return false;
  if (category === 'shopping' && shoppingEventHasCustomerSafeDisclosure(event.raw_text)) return false;
  if (category === 'shopping' || category === 'optional_tour' || category === 'notice') return event.match_status === 'review';
  if (category === 'unknown') return event.match_status !== 'ignored' && customerVisible(category);
  return false;
}

function isMatchedAttractionDetailBullet(rawText: string): boolean {
  return /^\s*[-–—]\s*\S/.test(rawText) && rawText.replace(/\s+/g, '').length >= 6;
}

function reviewKey(item: V3EntityReviewItem): string {
  if (item.category === 'attraction') {
    return [
      item.category,
      item.raw_text.replace(/\s+/g, '').trim().toLowerCase(),
      item.day_number ?? 'unknown_day',
    ].join('|');
  }
  return [
    item.category,
    item.raw_text.replace(/\s+/g, ' ').trim().toLowerCase(),
    item.evidence.line_start,
    item.evidence.line_end,
  ].join('|');
}

function hasAutoCleanOptionalDisclosure(variant: V3DraftLedger['variants'][number]): boolean {
  return variant.structured_facts.some(fact =>
    fact.category === 'optional_tour'
    && fact.review_status === 'auto_clean'
  ) || variant.standard_notices.some(notice =>
    notice.category === 'optional_tour'
    && notice.review_status === 'auto_clean'
  );
}

function hasAutoCleanShoppingDisclosure(variant: V3DraftLedger['variants'][number]): boolean {
  return variant.structured_facts.some(fact =>
    fact.category === 'shopping_policy'
    && fact.review_status === 'auto_clean'
  ) || variant.standard_notices.some(notice =>
    notice.category === 'shopping_visit'
    && notice.review_status === 'auto_clean'
  );
}

function optionHasCustomerSafeDisclosure(option: { raw_name: string; normalized_name: string; price_amount: number | null; currency: string | null }): boolean {
  return Boolean(
    option.normalized_name?.trim()
    && typeof option.price_amount === 'number'
    && option.price_amount > 0
    && option.currency,
  );
}

function optionIsGenericCostOrHeading(option: { raw_name: string }): boolean {
  const compact = option.raw_name
    .replace(/^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663()]+/, '')
    .replace(/\s+/g, '');
  return /^(?:\ud604\uc9c0\uc9c0\ubd88\uc635\uc158|\uac15\ub825\ucd94\ucc9c\uc635\uc158|\ucd94\ucc9c\uc635\uc158|\uc120\ud0dd\uad00\uad11\ube44\uc6a9|\uc720\ub958\ubcc0\ub3d9\ubd84|\ub9e4\ub108\ud301\ubc0f\uac1c\uc778\uacbd\ube44|\uac1c\uc778\uacbd\ube44)$/.test(compact)
    || /^(?:\uae30\uc0ac\/?\uac00\uc774\ub4dc\uacbd\ube44|\uac00\uc774\ub4dc\/?\uae30\uc0ac\uacbd\ube44)\$?\d+/i.test(compact);
}

function shoppingHasCustomerSafeDisclosure(value: string): boolean {
  if (hasExplicitShoppingCountDisclosure(value)) return true;
  return /쇼핑(?:센터)?\s*\d+\s*회|\d+\s*회/.test(value)
    && /(침향|한약|라텍스|차가버섯|죽탄|콜라겐|보이차|농산물|잡화|토산품|기념품|면세|노니|커피)/i.test(value);
}

export function buildEntityReviewItem(input: {
  event: V3LedgerEvent;
  dayNumber: number | null;
  destination?: string | null;
  country?: string | null;
}): V3EntityReviewItem {
  const initialCategory = entityCategoryForEventType(input.event.type);
  const attractionReviewText = initialCategory === 'attraction'
    ? normalizeAttractionReviewText(input.event.raw_text)
    : input.event.raw_text;
  const category: V3EntityCategory = initialCategory === 'attraction' && !attractionReviewText
    ? 'notice'
    : initialCategory;
  const foodTerm = category === 'meal' ? regionalFoodTerm(input.event.raw_text) : null;
  const confidence = confidenceFor(category, input.event);
  const suggested_action = suggestedActionFor(category, input.event);
  return {
    raw_text: attractionReviewText ?? input.event.raw_text,
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
      const dayHasMatchedAttraction = day.events.some(event =>
        event.type === 'attraction'
        && event.match_status === 'matched'
        && Boolean(event.canonical_id),
      );
      for (const event of day.events) {
        const baseItem = buildEntityReviewItem({
          event,
          dayNumber: day.day,
          destination: input.destination,
          country: input.country,
        });
        const item = baseItem.category === 'attraction'
          && baseItem.blocks_publish
          && dayHasMatchedAttraction
          && isMatchedAttractionDetailBullet(event.raw_text)
          ? {
              ...baseItem,
              category: 'notice' as const,
              suggested_action: 'auto_resolve_existing' as const,
              blocks_publish: false,
              suggested_resolution: {
                ...baseItem.suggested_resolution,
                category: 'notice' as const,
                policy: 'matched-attraction-detail-bullet',
              },
            }
          : baseItem;
        addItem(item);
      }
    }

    for (const option of variant.options) {
      const optionClean = hasAutoCleanOptionalDisclosure(variant)
        || optionHasCustomerSafeDisclosure(option)
        || optionIsGenericCostOrHeading(option);
      const event: V3LedgerEvent = {
        type: 'option',
        time: null,
        raw_text: option.raw_name,
        canonical_id: null,
        canonical_type: 'option',
        match_status: optionClean ? 'matched' : option.match_status,
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
      const shoppingClean = hasAutoCleanShoppingDisclosure(variant) || shoppingHasCustomerSafeDisclosure(shopping.value);
      const event: V3LedgerEvent = {
        type: 'shopping',
        time: null,
        raw_text: shopping.value,
        canonical_id: null,
        canonical_type: 'shopping',
        match_status: shoppingClean ? 'matched' : 'review',
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
