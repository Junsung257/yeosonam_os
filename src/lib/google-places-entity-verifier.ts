import { getSecret } from '@/lib/secret-registry';
import type { CandidateExternalSource } from '@/lib/entity-master-candidates';

export type GooglePlacesEvidenceItem = {
  query: string;
  placeId: string;
  displayName: string;
  formattedAddress: string | null;
  types: string[];
  googleMapsUri: string | null;
  websiteUri: string | null;
  nameMatches: boolean;
  regionMatches: boolean;
  countryMatches: boolean;
  typeMatches: boolean;
  score: number;
};

export type GooglePlacesVerificationInput = {
  label: string;
  aliases?: string[];
  region?: string | null;
  country?: string | null;
  destination?: string | null;
  scopeHints?: string[];
  category?: string | null;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
  remainingDailyCalls?: number;
  maxQueriesPerCandidate?: number;
  skipReason?: string;
};

export type GooglePlacesVerificationResult = {
  configured: boolean;
  enabled: boolean;
  remainingDailyCalls: number;
  maxQueriesPerCandidate: number;
  canonicalName: string;
  score: number;
  evidence: GooglePlacesEvidenceItem[];
  sources: CandidateExternalSource[];
  hasStrongPlaceIdentity: boolean;
  regionConflict: boolean;
  attempts: Array<{
    source: 'google_places';
    query: string;
    status: 'success' | 'empty' | 'error' | 'skipped';
    score: number;
    evidence: Record<string, unknown>;
    error?: string;
  }>;
};

const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const COUNTRY_VARIANTS: Record<string, string[]> = {
  CN: ['china', '중국', '中國', '中国'],
  VN: ['vietnam', 'viet nam', '베트남', 'việt nam'],
  JP: ['japan', '일본', '日本'],
  KR: ['korea', 'south korea', '대한민국', '한국'],
  TW: ['taiwan', '대만', '臺灣', '台湾'],
  TH: ['thailand', '태국'],
  PH: ['philippines', '필리핀'],
  US: ['united states', 'usa', '미국'],
};

const ATTRACTION_TYPES = new Set([
  'tourist_attraction',
  'museum',
  'park',
  'amusement_park',
  'aquarium',
  'art_gallery',
  'church',
  'hindu_temple',
  'mosque',
  'synagogue',
  'zoo',
  'point_of_interest',
  'establishment',
]);

const HOTEL_TYPES = new Set(['lodging', 'hotel', 'point_of_interest', 'establishment']);

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value: string | null | undefined): string {
  return clean(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9가-힣一-龥ぁ-ゔァ-ヴー]/gu, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function truthy(value: string | null | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(clean(value));
}

function intEnv(value: string | null | undefined, fallback: number): number {
  const parsed = Number(clean(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

export type GooglePlacesBudget = {
  enabled: boolean;
  dailyLimit: number;
  remainingDailyCalls: number;
  maxQueriesPerCandidate: number;
  skipReason?: string;
};

export function getGooglePlacesBudgetFromEnv(usedToday = 0): GooglePlacesBudget {
  const enabled = truthy(getSecret('GOOGLE_PLACES_ENABLED'));
  const dailyLimit = intEnv(getSecret('GOOGLE_PLACES_DAILY_LIMIT'), 0);
  const maxQueriesPerCandidate = Math.max(1, intEnv(getSecret('GOOGLE_PLACES_MAX_QUERIES_PER_CANDIDATE'), 1));
  const remainingDailyCalls = Math.max(0, dailyLimit - Math.max(0, Math.floor(usedToday)));
  let skipReason: string | undefined;
  if (!enabled) skipReason = 'GOOGLE_PLACES_ENABLED is not true';
  else if (dailyLimit <= 0) skipReason = 'GOOGLE_PLACES_DAILY_LIMIT is 0';
  else if (remainingDailyCalls <= 0) skipReason = 'GOOGLE_PLACES_DAILY_LIMIT exhausted';
  return { enabled, dailyLimit, remainingDailyCalls, maxQueriesPerCandidate, skipReason };
}

function countryVariants(country?: string | null): string[] {
  const value = clean(country);
  if (!value) return [];
  const upper = value.toUpperCase();
  return unique([value, ...(COUNTRY_VARIANTS[upper] ?? [])]);
}

function agreesWithAnyName(candidate: string, names: string[]): boolean {
  const value = compact(candidate);
  if (value.length < 2) return false;
  return names.some(name => {
    const other = compact(name);
    return other.length >= 2 && (value === other || value.includes(other) || other.includes(value));
  });
}

function buildQueries(input: GooglePlacesVerificationInput): string[] {
  const names = unique([input.label, ...(input.aliases ?? [])]).filter(value => value.length >= 2);
  const scopes = unique([
    input.region ?? '',
    input.destination ?? '',
    ...(input.scopeHints ?? []),
    ...countryVariants(input.country),
  ])
    .filter(value => value.length >= 2 && value.length <= 32)
    .slice(0, 4);

  const queries: string[] = [];
  for (const name of names.slice(0, 4)) {
    queries.push(name);
    for (const scope of scopes) {
      if (!compact(name).includes(compact(scope))) queries.push(`${scope} ${name}`);
    }
  }
  return unique(queries).slice(0, 8);
}

function expectedTypes(category?: string | null): Set<string> {
  return category === 'hotel' ? HOTEL_TYPES : ATTRACTION_TYPES;
}

function scorePlace(input: GooglePlacesVerificationInput, place: GooglePlace, query: string): GooglePlacesEvidenceItem {
  const names = unique([input.label, ...(input.aliases ?? [])]);
  const displayName = clean(place.displayName?.text);
  const formattedAddress = clean(place.formattedAddress) || null;
  const haystack = `${displayName} ${formattedAddress ?? ''}`;
  const regionTokens = unique([input.region ?? '', input.destination ?? '', ...(input.scopeHints ?? [])]);
  const countries = countryVariants(input.country);
  const nameMatches = agreesWithAnyName(displayName, names);
  const regionMatches = regionTokens.some(region => compact(haystack).includes(compact(region)));
  const countryMatches = countries.length === 0 || countries.some(country => compact(haystack).includes(compact(country)));
  const typeMatches = (place.types ?? []).some(type => expectedTypes(input.category).has(type));
  const score = clamp(
    (nameMatches ? 0.48 : 0) +
    (regionMatches ? 0.22 : 0) +
    (countryMatches ? 0.18 : 0) +
    (typeMatches ? 0.12 : 0),
  );

  return {
    query,
    placeId: place.id ?? place.name?.replace(/^places\//, '') ?? '',
    displayName,
    formattedAddress,
    types: place.types ?? [],
    googleMapsUri: clean(place.googleMapsUri) || null,
    websiteUri: clean(place.websiteUri) || null,
    nameMatches,
    regionMatches,
    countryMatches,
    typeMatches,
    score,
  };
}

type GooglePlace = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  types?: string[];
  googleMapsUri?: string;
  websiteUri?: string;
};

async function searchGooglePlaces(query: string, input: GooglePlacesVerificationInput, fetchImpl: typeof fetch): Promise<GooglePlacesEvidenceItem[]> {
  const apiKey = getSecret('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return [];

  const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.name',
        'places.displayName',
        'places.formattedAddress',
        'places.types',
        'places.googleMapsUri',
        'places.websiteUri',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ko',
      maxResultCount: 5,
    }),
  });
  if (!response.ok) throw new Error(`google places ${response.status}`);

  const json = await response.json() as { places?: GooglePlace[] };
  return (json.places ?? [])
    .map(place => scorePlace(input, place, query))
    .filter(item => item.placeId && item.displayName)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function hasRegionConflict(best: GooglePlacesEvidenceItem | undefined, input: GooglePlacesVerificationInput): boolean {
  if (!best) return false;
  const expectedCountries = countryVariants(input.country).map(compact).filter(Boolean);
  if (expectedCountries.length === 0 || best.countryMatches) return false;
  const address = compact(best.formattedAddress ?? '');
  const knownOtherCountry = Object.entries(COUNTRY_VARIANTS)
    .filter(([code]) => code !== clean(input.country).toUpperCase())
    .flatMap(([, variants]) => variants.map(compact))
    .some(value => value.length >= 2 && address.includes(value));
  return knownOtherCountry;
}

export async function verifyGooglePlacesEntityName(
  input: GooglePlacesVerificationInput,
): Promise<GooglePlacesVerificationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiKey = getSecret('GOOGLE_PLACES_API_KEY');
  const configured = Boolean(apiKey);
  const envBudget = getGooglePlacesBudgetFromEnv();
  const enabled = input.enabled ?? envBudget.enabled;
  const remainingDailyCalls = Math.max(0, Math.floor(input.remainingDailyCalls ?? envBudget.remainingDailyCalls));
  const maxQueriesPerCandidate = Math.max(1, Math.floor(input.maxQueriesPerCandidate ?? envBudget.maxQueriesPerCandidate));
  const fallback = clean(input.label);
  const attempts: GooglePlacesVerificationResult['attempts'] = [];
  const skipReason = !configured
    ? 'GOOGLE_PLACES_API_KEY missing'
    : input.skipReason || (!enabled
      ? 'GOOGLE_PLACES_ENABLED is not true'
      : remainingDailyCalls <= 0
        ? 'GOOGLE_PLACES_DAILY_LIMIT exhausted'
        : '');
  if (!configured || !enabled || remainingDailyCalls <= 0) {
    return {
      configured,
      enabled,
      remainingDailyCalls,
      maxQueriesPerCandidate,
      canonicalName: fallback,
      score: 0,
      evidence: [],
      sources: [],
      hasStrongPlaceIdentity: false,
      regionConflict: false,
      attempts: [{
        source: 'google_places',
        query: fallback,
        status: 'skipped',
        score: 0,
        evidence: {
          reason: skipReason,
          remainingDailyCalls,
          maxQueriesPerCandidate,
        },
      }],
    };
  }

  const evidence: GooglePlacesEvidenceItem[] = [];
  const queries = buildQueries(input).slice(0, Math.min(maxQueriesPerCandidate, remainingDailyCalls));
  for (const query of queries) {
    try {
      const items = await searchGooglePlaces(query, input, fetchImpl);
      evidence.push(...items);
      attempts.push({
        source: 'google_places',
        query,
        status: items.length > 0 ? 'success' : 'empty',
        score: items[0]?.score ?? 0,
        evidence: {
          top: items.slice(0, 3),
          matchedItems: items.filter(item => item.nameMatches).length,
        },
      });
    } catch (error) {
      attempts.push({
        source: 'google_places',
        query,
        status: 'error',
        score: 0,
        evidence: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sorted = evidence
    .sort((a, b) => b.score - a.score || Number(b.regionMatches) - Number(a.regionMatches));
  const best = sorted[0];
  const regionConflict = hasRegionConflict(best, input);
  const score = regionConflict ? clamp((best?.score ?? 0) * 0.45) : (best?.score ?? 0);
  const hasStrongPlaceIdentity = Boolean(best && !regionConflict && best.score >= 0.78 && best.nameMatches && best.typeMatches);
  const sources: CandidateExternalSource[] = best && score >= 0.55
    ? [{
        source: 'google_places',
        id: best.placeId,
        url: best.googleMapsUri,
        confidence: score,
        name: best.displayName,
      }]
    : [];

  return {
    configured,
    enabled,
    remainingDailyCalls: Math.max(0, remainingDailyCalls - attempts.filter(attempt => attempt.status !== 'skipped').length),
    maxQueriesPerCandidate,
    canonicalName: best?.displayName || fallback,
    score,
    evidence: sorted.slice(0, 10),
    sources,
    hasStrongPlaceIdentity,
    regionConflict,
    attempts,
  };
}
