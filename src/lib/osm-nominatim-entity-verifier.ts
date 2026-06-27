import type { CandidateExternalSource } from '@/lib/entity-master-candidates';

export type OsmNominatimEvidenceItem = {
  query: string;
  osmId: string;
  osmType: string;
  displayName: string;
  name: string;
  category: string | null;
  type: string | null;
  lat: number | null;
  lon: number | null;
  url: string;
  nameMatches: boolean;
  regionMatches: boolean;
  countryMatches: boolean;
  typeMatches: boolean;
  score: number;
};

export type OsmNominatimVerificationInput = {
  label: string;
  aliases?: string[];
  region?: string | null;
  country?: string | null;
  destination?: string | null;
  scopeHints?: string[];
  category?: string | null;
  fetchImpl?: typeof fetch;
  maxQueriesPerCandidate?: number;
};

export type OsmNominatimVerificationResult = {
  configured: boolean;
  canonicalName: string;
  score: number;
  evidence: OsmNominatimEvidenceItem[];
  sources: CandidateExternalSource[];
  hasStrongPlaceIdentity: boolean;
  regionConflict: boolean;
  attempts: Array<{
    source: 'osm_nominatim';
    query: string;
    status: 'success' | 'empty' | 'error' | 'skipped';
    score: number;
    evidence: Record<string, unknown>;
    error?: string;
  }>;
};

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) entity-resolution';

const COUNTRY_VARIANTS: Record<string, string[]> = {
  CN: ['china'],
  VN: ['vietnam', 'viet nam'],
  JP: ['japan'],
  KR: ['korea', 'south korea'],
  TW: ['taiwan'],
  TH: ['thailand'],
  PH: ['philippines'],
  SG: ['singapore'],
  MY: ['malaysia'],
  ID: ['indonesia'],
  US: ['united states', 'usa'],
};

const ATTRACTION_TYPES = new Set([
  'attraction',
  'museum',
  'theme_park',
  'viewpoint',
  'gallery',
  'zoo',
  'aquarium',
  'park',
  'garden',
  'monument',
  'memorial',
  'castle',
  'temple',
  'church',
  'beach',
  'waterfall',
]);

const ATTRACTION_CLASSES = new Set(['tourism', 'historic', 'leisure', 'natural', 'amenity']);
const HOTEL_TYPES = new Set(['hotel', 'motel', 'resort', 'guest_house', 'hostel', 'apartment']);

type NominatimResult = {
  osm_type?: string;
  osm_id?: number | string;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  namedetails?: Record<string, string>;
};

function clean(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value: string | null | undefined): string {
  return clean(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9가-힣ぁ-ゟァ-ヿ一-龯]/gu, '');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
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

function buildQueries(input: OsmNominatimVerificationInput): string[] {
  const names = unique([input.label, ...(input.aliases ?? [])]).filter(value => value.length >= 2);
  const scopes = unique([
    input.region ?? '',
    input.destination ?? '',
    ...(input.scopeHints ?? []),
    ...countryVariants(input.country),
  ]).filter(value => value.length >= 2 && value.length <= 32);

  const queries: string[] = [];
  for (const name of names.slice(0, 3)) {
    queries.push(name);
    const scope = scopes.find(value => !compact(name).includes(compact(value)));
    if (scope) queries.push(`${name} ${scope}`);
  }
  return unique(queries).slice(0, Math.max(1, input.maxQueriesPerCandidate ?? 1));
}

function typeMatches(input: OsmNominatimVerificationInput, item: NominatimResult): boolean {
  const kind = clean(item.class);
  const type = clean(item.type);
  if (input.category === 'hotel') return kind === 'tourism' && HOTEL_TYPES.has(type);
  return ATTRACTION_CLASSES.has(kind) && (ATTRACTION_TYPES.has(type) || kind === 'historic' || kind === 'natural');
}

function osmUrl(osmType: string, osmId: string): string {
  const type = osmType.toLowerCase();
  if (type === 'n') return `https://www.openstreetmap.org/node/${osmId}`;
  if (type === 'w') return `https://www.openstreetmap.org/way/${osmId}`;
  if (type === 'r') return `https://www.openstreetmap.org/relation/${osmId}`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(osmId)}`;
}

function scoreResult(input: OsmNominatimVerificationInput, item: NominatimResult, query: string): OsmNominatimEvidenceItem | null {
  const osmId = clean(String(item.osm_id ?? ''));
  const osmType = clean(item.osm_type);
  const displayName = clean(item.display_name);
  if (!osmId || !osmType || !displayName) return null;

  const names = unique([input.label, ...(input.aliases ?? [])]);
  const resultName = clean(item.namedetails?.name ?? item.namedetails?.['name:ko'] ?? item.name ?? displayName.split(',')[0]);
  const haystack = `${resultName} ${displayName}`;
  const regionTokens = unique([input.region ?? '', input.destination ?? '', ...(input.scopeHints ?? [])]);
  const countries = countryVariants(input.country);
  const nameMatches = agreesWithAnyName(resultName, names) || agreesWithAnyName(displayName, names);
  const regionMatches = regionTokens.some(region => compact(haystack).includes(compact(region)));
  const countryMatches = countries.length === 0 || countries.some(country => compact(haystack).includes(compact(country)));
  const matchedType = typeMatches(input, item);
  const score = clamp(
    (nameMatches ? 0.5 : 0) +
    (regionMatches ? 0.2 : 0) +
    (countryMatches ? 0.18 : 0) +
    (matchedType ? 0.12 : 0),
  );

  return {
    query,
    osmId,
    osmType,
    displayName,
    name: resultName,
    category: clean(item.class) || null,
    type: clean(item.type) || null,
    lat: item.lat ? Number(item.lat) : null,
    lon: item.lon ? Number(item.lon) : null,
    url: osmUrl(osmType, osmId),
    nameMatches,
    regionMatches,
    countryMatches,
    typeMatches: matchedType,
    score,
  };
}

async function searchNominatim(query: string, input: OsmNominatimVerificationInput, fetchImpl: typeof fetch): Promise<OsmNominatimEvidenceItem[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('accept-language', 'ko,en');

  const response = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`osm nominatim ${response.status}`);
  const json = await response.json() as NominatimResult[];
  return (Array.isArray(json) ? json : [])
    .map(item => scoreResult(input, item, query))
    .filter((item): item is OsmNominatimEvidenceItem => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function hasRegionConflict(best: OsmNominatimEvidenceItem | undefined, input: OsmNominatimVerificationInput): boolean {
  if (!best) return false;
  const expectedCountries = countryVariants(input.country).map(compact).filter(Boolean);
  if (expectedCountries.length === 0 || best.countryMatches) return false;
  const display = compact(best.displayName);
  const knownOtherCountry = Object.entries(COUNTRY_VARIANTS)
    .filter(([code]) => code !== clean(input.country).toUpperCase())
    .flatMap(([, variants]) => variants.map(compact))
    .some(value => value.length >= 2 && display.includes(value));
  return knownOtherCountry;
}

export async function verifyOsmNominatimEntityName(
  input: OsmNominatimVerificationInput,
): Promise<OsmNominatimVerificationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const fallback = clean(input.label);
  const attempts: OsmNominatimVerificationResult['attempts'] = [];
  if (fallback.length < 2) {
    return {
      configured: true,
      canonicalName: fallback,
      score: 0,
      evidence: [],
      sources: [],
      hasStrongPlaceIdentity: false,
      regionConflict: false,
      attempts: [{
        source: 'osm_nominatim',
        query: fallback,
        status: 'skipped',
        score: 0,
        evidence: { reason: 'label too short' },
      }],
    };
  }

  const evidence: OsmNominatimEvidenceItem[] = [];
  for (const query of buildQueries(input)) {
    try {
      const items = await searchNominatim(query, input, fetchImpl);
      evidence.push(...items);
      attempts.push({
        source: 'osm_nominatim',
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
        source: 'osm_nominatim',
        query,
        status: 'error',
        score: 0,
        evidence: {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sorted = evidence.sort((a, b) => b.score - a.score || Number(b.regionMatches) - Number(a.regionMatches));
  const best = sorted[0];
  const regionConflict = hasRegionConflict(best, input);
  const score = regionConflict ? clamp((best?.score ?? 0) * 0.45) : (best?.score ?? 0);
  const hasStrongPlaceIdentity = Boolean(best && !regionConflict && best.score >= 0.82 && best.nameMatches && best.typeMatches);
  const sources: CandidateExternalSource[] = best && score >= 0.6
    ? [{
        source: 'osm_nominatim',
        id: `${best.osmType}:${best.osmId}`,
        url: best.url,
        confidence: score,
        name: best.name || best.displayName,
      }]
    : [];

  return {
    configured: true,
    canonicalName: best?.name || fallback,
    score,
    evidence: sorted.slice(0, 10),
    sources,
    hasStrongPlaceIdentity,
    regionConflict,
    attempts,
  };
}
