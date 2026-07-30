import type { BlogInformationIntent } from './blog-information-contract';

export interface BlogQualityUpgradeTopicInput {
  slug?: string | null;
  seoTitle?: string | null;
  category?: string | null;
}

export interface BlogQualityUpgradeTopicDecision {
  accepted: boolean;
  expectedIntent: BlogInformationIntent | null;
  microAngle: string | null;
  reason: string;
}

export type BlogQualityUpgradeExecutionMode =
  | 'deterministic'
  | 'human_review'
  | 'unsupported';

const DETERMINISTIC_UPGRADE_INTENTS = new Set<BlogInformationIntent>([
  'monthly_weather',
]);

const HUMAN_REVIEW_UPGRADE_INTENTS = new Set<BlogInformationIntent>([
  'entry_requirements',
  'travel_insurance',
]);

export function getBlogQualityUpgradeExecutionMode(
  intent: BlogInformationIntent,
): BlogQualityUpgradeExecutionMode {
  if (DETERMINISTIC_UPGRADE_INTENTS.has(intent)) return 'deterministic';
  if (HUMAN_REVIEW_UPGRADE_INTENTS.has(intent)) return 'human_review';
  return 'unsupported';
}

interface ExplicitIntentRule {
  intent: BlogInformationIntent;
  microAngle: string | null;
  pattern: RegExp;
}

const EXPLICIT_INTENT_RULES: ExplicitIntentRule[] = [
  {
    intent: 'entry_requirements',
    microAngle: null,
    pattern: /(?:비자|입국\s*(?:요건|조건|신고|심사)|여권\s*(?:조건|유효)|전자\s*(?:여행\s*)?허가|세관|면세\s*한도|visa|immigration|passport|eta|esta)/i,
  },
  {
    intent: 'travel_insurance',
    microAngle: null,
    pattern: /(?:여행자?\s*보험|해외\s*여행\s*보험|travel\s*insurance|수하물\s*(?:분실|지연)\s*보험)/i,
  },
  {
    intent: 'monthly_weather',
    microAngle: 'weather_packing',
    pattern: /(?:날씨|기후|옷차림|우기|건기|기온|강수|태풍|weather|climate|rainfall)/i,
  },
  {
    intent: 'food_budget',
    microAngle: 'food_budget',
    pattern: /(?:식비|음식값|메뉴\s*가격|맛집\s*비용|meal\s*budget|food\s*(?:cost|budget))/i,
  },
  {
    intent: 'hotel_areas',
    microAngle: 'hotel_area',
    pattern: /(?:숙소\s*(?:지역|위치|동네)|호텔\s*(?:지역|위치|동네)|어디에\s*묵|where\s*to\s*stay|hotel\s*areas?)/i,
  },
  {
    intent: 'currency_payment',
    microAngle: null,
    pattern: /(?:환율|환전|현지\s*화폐|현금\s*(?:준비|사용)|카드\s*결제|결제\s*수단|currency|exchange|payment)/i,
  },
  {
    intent: 'shopping_souvenirs',
    microAngle: 'shopping_budget',
    pattern: /(?:기념품|쇼핑\s*(?:리스트|품목|가격|장소)|선물\s*(?:추천|리스트)|souvenirs?|shopping\s*(?:list|guide|prices?))/i,
  },
  {
    intent: 'airport_transport',
    microAngle: 'airport_arrival',
    pattern: /(?:공항\s*(?:교통|이동|픽업|철도|버스|택시)|공항에서.+(?:시내|호텔|숙소)|airport\s*(?:transport|transfer)|arrival\s*transfer)/i,
  },
  {
    intent: 'local_transport',
    microAngle: 'local_mobility',
    pattern: /(?:대중교통|렌터카|택시\s*(?:요금|비용)|교통비|이동\s*(?:비용|수단)|public\s*transport|rental\s*car|transport\s*(?:cost|guide))/i,
  },
  {
    intent: 'family_budget',
    microAngle: 'budget_family',
    pattern: /(?:(?:가족|아이|아동|부모님|family|kid).*(?:예산|비용|경비|budget)|(?:예산|비용|경비|budget).*(?:가족|아이|아동|부모님|family|kid))/i,
  },
  {
    intent: 'itinerary',
    microAngle: 'kid_friendly',
    pattern: /(?:(?:가족|아이|아동|부모님|family|kid).*(?:일정|코스|동선|여정|itinerary|route)|(?:일정|코스|동선|여정|itinerary|route).*(?:가족|아이|아동|부모님|family|kid))/i,
  },
  {
    intent: 'itinerary',
    microAngle: null,
    pattern: /(?:\d+\s*박\s*\d+\s*일\s*(?:일정|코스)|일차별\s*(?:일정|코스)|여행\s*(?:일정|코스|동선)|itinerary|day[-\s]*by[-\s]*day)/i,
  },
];

function normalizedTopicText(value?: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findExplicitIntent(text: string): ExplicitIntentRule | null {
  return EXPLICIT_INTENT_RULES.find((rule) => rule.pattern.test(text)) ?? null;
}

export function classifyBlogQualityUpgradeTopic(
  input: BlogQualityUpgradeTopicInput,
): BlogQualityUpgradeTopicDecision {
  const slugText = normalizedTopicText(input.slug);
  const titleText = normalizedTopicText(input.seoTitle);
  if (!slugText && !titleText) {
    return {
      accepted: false,
      expectedIntent: null,
      microAngle: null,
      reason: 'missing_topic_signal',
    };
  }

  const publicText = `${slugText} ${titleText}`.trim();
  if (/(?:\b(?:vs|comparison|compare)\b|비교|(?:best|top)\s*\d+|추천\s*(?:best|top)?\s*\d+)/i.test(publicText)) {
    return {
      accepted: false,
      expectedIntent: null,
      microAngle: null,
      reason: 'comparison_or_listicle_requires_review',
    };
  }

  const slugMatch = findExplicitIntent(slugText);
  const titleMatch = findExplicitIntent(titleText);
  if (slugMatch && titleMatch && slugMatch.intent !== titleMatch.intent) {
    return {
      accepted: false,
      expectedIntent: null,
      microAngle: null,
      reason: 'conflicting_public_topic_signals',
    };
  }

  const match = slugMatch ?? titleMatch;
  if (!match) {
    return {
      accepted: false,
      expectedIntent: null,
      microAngle: null,
      reason: 'ambiguous_or_general_topic',
    };
  }

  return {
    accepted: true,
    expectedIntent: match.intent,
    microAngle: match.microAngle,
    reason: 'explicit_intent_signal',
  };
}

export function deduplicateBlogQualityUpgradeCandidates<T>(
  candidates: T[],
  representativeKey: (candidate: T) => string,
): { selected: T[]; duplicateCount: number } {
  const selected: T[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const candidate of candidates) {
    const key = representativeKey(candidate);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    selected.push(candidate);
  }

  return { selected, duplicateCount };
}

const QUALITY_UPGRADE_FILTER_INTENTS: Record<string, BlogInformationIntent | readonly BlogInformationIntent[]> = {
  weather: 'monthly_weather',
  currency: 'currency_payment',
  transport: ['airport_transport', 'local_transport'],
  hotel: 'hotel_areas',
  food: 'food_budget',
  shopping: 'shopping_souvenirs',
  family: 'family_budget',
  entry: 'entry_requirements',
  insurance: 'travel_insurance',
};

export function matchesBlogQualityUpgradeFilter(input: {
  filter?: string | null;
  intent: BlogInformationIntent;
  microAngle?: string | null;
}): boolean {
  const filter = (input.filter ?? '').trim().toLowerCase();
  if (!filter) return true;
  const expectedIntent = QUALITY_UPGRADE_FILTER_INTENTS[filter] ?? filter;
  return (Array.isArray(expectedIntent)
    ? expectedIntent.includes(input.intent)
    : input.intent === expectedIntent) || input.microAngle === filter;
}
