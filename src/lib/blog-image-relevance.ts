import type { PexelsPhoto } from './pexels';

const GENERIC_QUERY_TOKENS = new Set([
  'travel', 'destination', 'landscape', 'city', 'china', 'japan', 'korea',
  'vietnam', 'thailand', 'philippines', 'indonesia', 'malaysia', 'france',
  'italy', 'photo', 'photography',
]);

const INTENT_PROFILES: Array<{
  match: RegExp;
  query: string;
  visualTokens: string[];
}> = [
  {
    match: /날씨|계절|우기|건기|기온|강수|옷차림|weather|climate/i,
    query: 'seasonal cityscape weather travel',
    visualTokens: ['weather', 'season', 'rain', 'sun', 'cloud', 'winter', 'summer', 'snow', 'umbrella'],
  },
  {
    match: /맛집|식사|음식|식비|레스토랑|미식|food|meal|restaurant/i,
    query: 'local cuisine restaurant dishes street food',
    visualTokens: ['food', 'meal', 'dish', 'restaurant', 'cuisine', 'market', 'dining'],
  },
  {
    match: /호텔|숙소|리조트|객실|투숙|hotel|resort/i,
    query: 'hotel accommodation room exterior',
    visualTokens: ['hotel', 'room', 'resort', 'accommodation', 'lobby', 'bedroom'],
  },
  {
    match: /교통|이동|공항|항공|비행|픽업|지하철|버스|transport|airport/i,
    query: 'public transport airport train bus',
    visualTokens: ['airport', 'train', 'bus', 'subway', 'transport', 'terminal', 'traffic'],
  },
  {
    match: /비용|가격|예산|환전|경비|가성비|budget|cost|price/i,
    query: 'local market restaurant public transport',
    visualTokens: ['market', 'food', 'restaurant', 'transport', 'shopping', 'street'],
  },
  {
    match: /일정|코스|동선|일차|관광|명소|투어|체험|itinerary|sightseeing/i,
    query: 'landmark sightseeing walking route',
    visualTokens: ['landmark', 'street', 'temple', 'tower', 'museum', 'park', 'walking'],
  },
  {
    match: /쇼핑|시장|기념품|면세|shopping|souvenir/i,
    query: 'local market shopping street souvenirs',
    visualTokens: ['market', 'shopping', 'store', 'souvenir', 'street', 'mall'],
  },
  {
    match: /준비|체크리스트|준비물|팁|주의|packing|checklist/i,
    query: 'travel packing essentials luggage',
    visualTokens: ['luggage', 'suitcase', 'packing', 'passport', 'bag', 'traveler'],
  },
];

const COASTAL_RE = /beach|ocean|coast|sea|seaside|island|shore|wave/i;

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

function destinationTokens(destinationQuery: string): string[] {
  return [...new Set(normalizeWords(destinationQuery)
    .filter((word) => !GENERIC_QUERY_TOKENS.has(word)))]
    .slice(0, 5);
}

function resolveIntentProfile(context: string) {
  return INTENT_PROFILES.find((profile) => profile.match.test(context)) ?? {
    query: 'landmark cityscape local street',
    visualTokens: ['landmark', 'cityscape', 'street', 'architecture', 'travel'],
  };
}

export function buildBlogImageSearchQuery(input: {
  destinationQuery: string;
  primaryKeyword?: string | null;
  sectionTitle?: string | null;
}): string {
  const profile = resolveIntentProfile(`${input.primaryKeyword ?? ''} ${input.sectionTitle ?? ''}`);
  return `${input.destinationQuery} ${profile.query}`.replace(/\s+/g, ' ').trim();
}

export function scorePexelsPhotoRelevance(
  photo: PexelsPhoto,
  input: {
    destinationQuery: string;
    primaryKeyword?: string | null;
    sectionTitle?: string | null;
    rank?: number;
  },
): number {
  const context = `${input.primaryKeyword ?? ''} ${input.sectionTitle ?? ''}`;
  const profile = resolveIntentProfile(context);
  const alt = String(photo.alt ?? '').toLowerCase();
  const destTokens = destinationTokens(input.destinationQuery);
  const destinationMatch = destTokens.some((token) => alt.includes(token));
  const intentMatch = profile.visualTokens.some((token) => alt.includes(token));
  const destinationIsCoastal = COASTAL_RE.test(input.destinationQuery);
  const contextRequestsCoast = COASTAL_RE.test(context);

  let score = 36 - Math.min(24, Math.max(0, input.rank ?? 0) * 2);
  if (destinationMatch) score += 42;
  if (intentMatch) score += 22;
  if (!destinationMatch && !intentMatch) score -= 24;
  if (!alt.trim()) score -= 18;
  if (COASTAL_RE.test(alt) && !destinationIsCoastal && !contextRequestsCoast) score -= 80;
  if (photo.width > photo.height) score += 5;
  return score;
}

export function selectRelevantPexelsPhoto(
  photos: PexelsPhoto[],
  input: {
    destinationQuery: string;
    primaryKeyword?: string | null;
    sectionTitle?: string | null;
    usedUrls?: Set<string>;
    minimumScore?: number;
  },
): PexelsPhoto | null {
  const usedUrls = input.usedUrls ?? new Set<string>();
  const minimumScore = input.minimumScore ?? 28;
  const candidates = photos
    .map((photo, rank) => ({
      photo,
      score: scorePexelsPhotoRelevance(photo, { ...input, rank }),
      url: photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original,
    }))
    .filter((candidate) => candidate.url && !usedUrls.has(candidate.url))
    .sort((left, right) => right.score - left.score);

  return candidates[0] && candidates[0].score >= minimumScore
    ? candidates[0].photo
    : null;
}
