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

const STANDALONE_MEAL_LABEL_RE =
  /^(?:\uC804\uD1B5\uC2DD|BBQ|\uBC14\uBCA0\uD050|\uD604\uC9C0\uC2DD|\uD2B9\uC2DD|\uC911\uC2DD|\uC11D\uC2DD|\uD638\uD154\uC2DD|\uD55C\uC2DD|\uC591\uC2DD|\uC77C\uC2DD)$/i;

function isStandaloneMealLabel(rawText: string): boolean {
  return STANDALONE_MEAL_LABEL_RE.test(rawText.replace(/\s+/g, '').trim());
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
  if (/(?:\uc120\ud0dd\s*\uad00\uad11|\uc120\ud0dd\uad00\uad11).*(?:\uc870\uc778|\uc2e0\uccad\s*\ud6c4)/.test(rawText)) return true;
  return /\$\s*\d+(?:\.\d+)?/.test(rawText) && normalizeOptionDisclosureText(rawText).length >= 2;
}

function hasExplicitShoppingCountDisclosure(text: string): boolean {
  return /(?:\uc1fc\ud551|\uc1fc\ud551\uc13c\ud130|\uba74\uc138\uc810|\uba74\uc138).*\d+\s*(?:\uacf3|\ud68c).*(?:\ubc29\ubb38|\uc608\uc815)|\d+\s*(?:\uacf3|\ud68c).*(?:\uc1fc\ud551|\uc1fc\ud551\uc13c\ud130|\uba74\uc138\uc810|\uba74\uc138)|(?:\uc1fc\ud551\uc13c\ud130|\uba74\uc138\uc810|\uba74\uc138)\s*\ubc29\ubb38|(?:\uc790\uc728|\uc790\uc720)\s*\uc1fc\ud551/.test(text);
}

function shoppingEventHasCustomerSafeDisclosure(rawText: string): boolean {
  const compact = rawText.replace(/\s+/g, '');
  if (/쇼핑.*\d+\s*회|(?:차|캐시미어).*\d+\s*회/.test(compact)) return true;
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

const NORMAL_ATTRACTION_REVIEW_NOISE_RE =
  /(?:상기\s*일정|현지\s*사정|항공\s*및\s*현지\s*사정|변동될\s*수|변경될\s*수|양해|자유이용권|케이블카|왕복케이블카|탑승하여|차창|대기시간|중복\s*없는\s*관광\s*동선|드론촬영|나룻배|부산-광저우|다낭\s*귀환|사막\s*진입시\s*케이블카\s*또는\s*버스\s*이용|^OR$|^파타야$|^샤오관$|^호화호특$|^호화호트$|^아타미$|^이즈$|^후쿠오카$|^히타$|^난칸$|^유\s*후\s*인$|^뉴카멜리아$|^하노이$|부산항\s*출항|하카다항\s*(?:하선|출발)|입국\s*수속|증편특가|출발확정일|출발임박일|특정일|붉은색|초록색|부관훼리|카멜리아.*갓성비|특전\d|일-\s*수|자유식|성인\s*\/\s*아동|2명\s*이상\s*출발|2인\s*1실|별도\s*요금|취소시\s*위약금|중국\s*연휴|한정식|전골|연어회|뷔페|백숙|도시락|맥주\s*1\s*병|빵\s*\+\s*옥수수\s*\+\s*과일|무제한|폭포뷰|스탠다드|프리미엄|^\s*\d{1,2}[.\/-]\d{1,2}\s*\([^)]+\)\s*$|^\s*\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*$|^\s*\d{2}년\s*\d{1,2}[.\/]\d{1,2}|^\s*\d{3,5}\s*M\s*$)/i;

const NORMAL_ATTRACTION_LABEL_RULES: Array<[RegExp, string]> = [
  [/시나무런.*초원/i, '시나무런 초원'],
  [/유후거리/i, '유후거리'],
  [/동강호/i, '동강호풍경구'],
  [/고의령/i, '고의령'],
  [/남화선사|천년고찰/i, '남화선사'],
  [/상용호/i, '상용호'],
  [/두솔동굴/i, '두솔동굴'],
  [/양원사/i, '양원사'],
  [/골든브릿지/i, '골든브릿지'],
  [/미케비치/i, '미케비치'],
  [/다낭\s*대성당/i, '다낭 대성당'],
  [/영응사/i, '영응사'],
  [/오행산|마블\s*마운틴/i, '오행산'],
  [/한시장/i, '한시장'],
  [/사랑의\s*부두/i, '사랑의 부두'],
  [/호이안\s*야경/i, '호이안 야경'],
  [/떤키|내원교|풍흥|광조회관|호이안\s*구시가지/i, '호이안 구시가지'],
  [/대협곡\s*유리다리/i, '대협곡 유리다리'],
  [/토가풍정원/i, '토가풍정원'],
  [/춘쿤산/i, '춘쿤산'],
  [/샹샤완/i, '샹샤완'],
  [/대당불야성/i, '대당불야성'],
  [/모아산/i, '모아산국가 삼림공원'],
  [/내몽고박물관/i, '내몽고박물관'],
  [/사이샹\s*옛거리|사이샹옛거리/i, '사이샹 옛거리'],
  [/멍량풍정원|몽골족의\s*전통문화/i, '멍량풍정원'],
  [/아타미\s*매화원/i, '아타미 매화원'],
  [/아타미\s*친수공원/i, '아타미 친수공원'],
  [/슈젠지/i, '슈젠지'],
  [/오와쿠다니/i, '오와쿠다니 유황계곡'],
  [/잔교/i, '잔교'],
  [/5\.?4\s*광장|오사광장/i, '5.4광장'],
  [/팔대관/i, '팔대관'],
  [/긴린호수/i, '긴린호수'],
  [/민예거리/i, '유후인 민예거리'],
];

function normalizeAttractionReviewText(rawText: string): string | null {
  const cleaned = rawText
    .replace(ATTRACTION_REVIEW_PREFIX_RE, '')
    .replace(/&#8211;|&ndash;|[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (/^(?:\uBBF8\uC81C\uACF5|\uBD88\uD3EC\uD568|\uD3EC\uD568|\uC81C\uACF5|\uC5C6\uC74C|N\/A|NA|-)$/.test(cleaned.replace(/\s+/g, ''))) return null;
  if (GUANGZHOU_DESCRIPTION_WITHOUT_MASTER_RE.test(cleaned)) return null;

  const withoutTrailingParen = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const compact = withoutTrailingParen.replace(/\s+/g, '');
  if (/^\d{1,2}[.\/-]\d{1,2}(?:\([^)]+\))?$/.test(compact)) return null;
  if (NORMAL_ATTRACTION_REVIEW_NOISE_RE.test(withoutTrailingParen) || NORMAL_ATTRACTION_REVIEW_NOISE_RE.test(compact)) return null;

  const normalLabel = NORMAL_ATTRACTION_LABEL_RULES.find(([pattern]) => pattern.test(withoutTrailingParen) || pattern.test(compact))?.[1];
  if (normalLabel) return normalLabel;

  if (/(?:입니다|보이며|드러냅니다|하나입니다)\.?$/.test(withoutTrailingParen)) return null;
  if (/^(?:1,?200년|길이\s*\d|총길이\s*\d|신선이\s*만든)/.test(withoutTrailingParen)) return null;
  if (/황하강이.*푸른\s*물/.test(withoutTrailingParen)) return null;

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
  if (/^(?:\uc0c1\ud488\uba85|\uc81c\ubaa9|title)[:：]/i.test(option.raw_name.trim())) return true;
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
  const preclassifiedCategory: V3EntityCategory = initialCategory === 'attraction' && isStandaloneMealLabel(input.event.raw_text)
    ? 'meal'
    : initialCategory;
  const attractionReviewText = preclassifiedCategory === 'attraction'
    ? normalizeAttractionReviewText(input.event.raw_text)
    : input.event.raw_text;
  const category: V3EntityCategory = preclassifiedCategory === 'attraction' && !attractionReviewText
    ? 'notice'
    : preclassifiedCategory;
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
