import {
  destinationAllowsAttractionScope,
  isRecognizableAttractionMaster,
  isMatchableAttractionAlias,
  matchAttractions,
  type AttractionData,
} from '@/lib/attraction-matcher';
import { inferHighConfidenceAttractionLabels } from '@/lib/attraction-description-canonical';
import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';

const sortedAttractionCache = new WeakMap<AttractionData[], AttractionData[]>();
type PublicCanonicalNameIndex = {
  byCompactName: Map<string, AttractionData | null>;
  lengths: number[];
};
const publicCanonicalNameIndexCache = new WeakMap<AttractionData[], PublicCanonicalNameIndex>();

function attractionsByLongestCanonicalName(attractions: AttractionData[]): AttractionData[] {
  const cached = sortedAttractionCache.get(attractions);
  if (cached) return cached;
  const sorted = attractions.slice().sort((a, b) => normalizeDirectTerm(b.name).length - normalizeDirectTerm(a.name).length);
  sortedAttractionCache.set(attractions, sorted);
  return sorted;
}

function publicCanonicalNameIndex(attractions: AttractionData[]): PublicCanonicalNameIndex {
  const cached = publicCanonicalNameIndexCache.get(attractions);
  if (cached) return cached;
  const byCompactName = new Map<string, AttractionData | null>();
  const lengths = new Set<number>();
  for (const attraction of attractions) {
    if (!isDirectScanEligibleTerm(attraction.name, attraction, undefined, '')) continue;
    const compactName = normalizeDirectTerm(attraction.name);
    if (compactName.length < 2 || compactName.length > 24) continue;
    if (byCompactName.has(compactName)) {
      byCompactName.set(compactName, null);
      continue;
    }
    byCompactName.set(compactName, attraction);
    lengths.add(compactName.length);
  }
  const index = {
    byCompactName,
    lengths: [...lengths].sort((a, b) => b - a),
  };
  publicCanonicalNameIndexCache.set(attractions, index);
  return index;
}

export interface ItineraryScheduleItem {
  activity: string;
  note?: string | null;
  type?: string;
  [key: string]: unknown;
}

export interface ItineraryDayLike {
  day?: number;
  schedule?: ItineraryScheduleItem[];
  [key: string]: unknown;
}

export interface ItineraryDataLike {
  days?: ItineraryDayLike[];
  [key: string]: unknown;
}

export interface EnrichResult {
  itineraryData: ItineraryDataLike | null;
  matchedCanonicalNames: string[];
  matchedScheduleItemCount: number;
  unmatchedCandidates: { activity: string; day_number: number }[];
}

const SKIP_TYPES = new Set(['flight', 'hotel', 'shopping', 'meal', 'notice', 'free_time', 'option', 'meeting']);
const DIRECT_SCAN_EXCLUDED_CATEGORIES = new Set(['accommodation', 'hotel', 'mrt_product']);
const DIRECT_SCAN_STOP_TERMS = new Set([
  '호텔 투숙',
  '쇼핑센터',
  '가이드 미팅',
  '전용차량',
  '90분',
]);

const MINIMUM_ACTIVITY_HINT_RE =
  /\uB514\uC2A4\uCEE4\uBC84\uB9AC|\uC7AC\uB798\uC2DC\uC7A5|\uC5F4\uB300\uACFC\uC77C|\uC2A4\uCFE0\uBC84|\uB2E4\uC774\uBE59|\uB9C8\uC0AC\uC9C0|\uD638\uD551|\uC2DC\uB0B4\uAD00\uAD11|\uC288\uB77C\uC778|\uC0B0\uD1A0\uB2C8\uB1E8|\uAE30\uB150\uD488|\uD1A0\uC0B0\uD488/;
const NON_SIGHTSEEING_ATTRACTION_ROW_RE =
  /(?:eSIM|유심|데이터|해외\s*여행\s*데이터|필수|이용권|패스|쿠폰)/i;

function normalizeDirectTerm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '').trim();
}

function isHangulSyllable(value: string): boolean {
  return /^[\uAC00-\uD7A3]$/.test(value);
}

function hasTermBoundary(text: string, term: string): boolean {
  const needle = term.trim();
  if (!needle) return false;
  let index = text.indexOf(needle);
  while (index >= 0) {
    const before = index > 0 ? text[index - 1] : '';
    const after = text[index + needle.length] ?? '';
    if (!isHangulSyllable(before) && !isHangulSyllable(after)) return true;
    index = text.indexOf(needle, index + 1);
  }
  return false;
}

function destinationAllowsAttraction(attraction: AttractionData, destination?: string): boolean {
  return destinationAllowsAttractionScope(attraction, destination);
}

function isSightseeingAttractionRow(attraction: AttractionData): boolean {
  return isRecognizableAttractionMaster(attraction) && !NON_SIGHTSEEING_ATTRACTION_ROW_RE.test([
    attraction.name,
    attraction.category ?? '',
    ...(attraction.aliases ?? []),
  ].join(' '));
}

function hasAttractionScope(attraction: AttractionData): boolean {
  return Boolean(normalizeDirectTerm(attraction.region) || normalizeDirectTerm(attraction.country));
}

function directTermOccurs(text: string, term: string): boolean {
  const clean = term.trim().toLowerCase();
  if (!clean) return false;
  const compact = clean.replace(/\s+/g, '');
  if (compact.length <= 2) return hasTermBoundary(text.toLowerCase(), clean);
  return normalizeDirectTerm(text).includes(compact);
}

function attractionNameOccurs(text: string, attraction: AttractionData): boolean {
  return typeof attraction.name === 'string' && directTermOccurs(text, attraction.name);
}

function contextAllowsAttractionScope(attraction: AttractionData, text: string): boolean {
  const compact = normalizeDirectTerm(text);
  const region = normalizeDirectTerm(attraction.region);
  if (!region) return true;
  if (compact.includes(region) || region.includes(compact)) return true;
  return region
    .split(/[,/|&]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .some(token => compact.includes(token));
}

function isDirectScanEligibleTerm(term: string, attraction: AttractionData, destination?: string, text = ''): boolean {
  const clean = term.trim();
  if (clean.length < 2 || clean.length > 24) return false;
  if (DIRECT_SCAN_STOP_TERMS.has(clean)) return false;
  if (clean !== attraction.name && !isMatchableAttractionAlias(clean, attraction)) return false;
  if (!isSightseeingAttractionRow(attraction)) return false;
  if (attraction.category && DIRECT_SCAN_EXCLUDED_CATEGORIES.has(attraction.category)) return false;
  if (destination && !destinationAllowsAttraction(attraction, destination) && !contextAllowsAttractionScope(attraction, text)) return false;
  return true;
}

function isDirectScanUnsafeActivity(activity: string): boolean {
  const compact = activity.replace(/\s+/g, '');
  if (!compact) return true;
  if (isHotelOperationLine(activity)) return true;
  if (/(?:\uB9C8\uC0AC\uC9C0|\uC774\uB3D9|\uC18C\uC694|\uD638\uD154|\uACF5\uD56D|\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD|\uAC00\uC774\uB4DC\uBBF8\uD305)/.test(compact)) {
    return !/(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uB77C\uC6B4\uB529|\uACE8\uD504\uC7A5|CC)/.test(compact);
  }
  return false;
}

function isHotelOperationLine(text: string): boolean {
  return /(?:\bcheck\s*[- ]?\s*(?:in|out)\b|\uCCB4\uD06C\s*(?:\uC778|\uC544\uC6C3)|\uCCB4\uD06C\s*[- ]?\s*(?:in|out))/i.test(text);
}

function compactScheduleText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '');
}

function hasAttractionVisitHint(text: string): boolean {
  const compact = compactScheduleText(text);
  return /(?:\uAD00\uAD11|\uAD00\uB78C|\uBC29\uBB38|\uCCB4\uD5D8|\uB4F1\uC815|\uAC10\uC0C1|\uD22C\uC5B4|\uC1FC|\uC0B0\uCC45|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uC77C\uC1A1\uC815|\uD574\uB780\uAC15|\uCC9C\uC9C0|\uC628\uCC9C\uC9C0\uB300|\uACBD\uACC4\uBE44|\uB300\uD611\uACE1|\uACE0\uC0B0\uD654\uC6D0|\uB77C\uC6B4\uB529|\uACE8\uD504\uC7A5|CC)/.test(compact);
}

function isSupplierHeaderOrCommerceLine(text: string): boolean {
  const compact = compactScheduleText(text);
  return /(?:\uD604\uC9C0\uC9C0\uBD88\uC635\uC158|\uC120\uD0DD\uAD00\uAD11|\uCD9C\uBC1C\uC99D\uD3B8|\uCD9C\uBC1C\uC77C|\uC0C1\uD488\uAC00|\uC694\uAE08\uD45C|\uD328\uD134|\uB178\uC635\uC158|\uB178\uC1FC\uD551|\uB178\uD301)/.test(compact)
    || /(?:\$|\uFF04)\s*\d/.test(text)
    || /(?:\uBAA9\uC694\uC77C|\uC77C\uC694\uC77C)\d*\uBC15\d*\uC77C/.test(compact);
}

function isHotelStayLine(text: string): boolean {
  const compact = compactScheduleText(text);
  if (!/(?:\uD638\uD154|\uB9AC\uC870\uD2B8|\uD22C\uC219|\uB3D9\uAE09|\uC900\s*5\uC131|\uB178\uBCF4\uD154|\uD558\uC580\uD2B8|hotel|resort|novotel|hyatt)/i.test(compact)) {
    return false;
  }
  return !hasAttractionVisitHint(text);
}

function shouldStripAttractionReferences(item: ItineraryScheduleItem): boolean {
  const text = [item.activity, item.note ?? ''].filter(Boolean).join(' ');
  if (isHotelOperationLine(text)) return true;
  if (isHotelStayLine(text)) return true;
  if (isSupplierHeaderOrCommerceLine(text)) return true;
  if (item.entity_kind === 'optional_tour') return true;
  if (item.entity_kind === 'perk' && !hasAttractionVisitHint(text)) return true;
  if (item.entity_kind === 'transfer' && !hasAttractionVisitHint(text)) return true;
  return false;
}

function removeAttractionReferences(item: ItineraryScheduleItem): ItineraryScheduleItem {
  const {
    attraction_ids: _ids,
    attraction_names: _names,
    attraction_note: _note,
    attraction_query: _query,
    attraction_queries: _queries,
    ...rest
  } = item;
  void _ids;
  void _names;
  void _note;
  void _query;
  void _queries;
  return rest;
}

function dedupeAttractionMatches(values: AttractionData[], text: string): AttractionData[] {
  const compact = compactScheduleText(text);
  let filtered = values
    .filter(isSightseeingAttractionRow)
    .filter(value => hasAttractionScope(value) || attractionNameOccurs(text, value));

  if (/\uC545\uD654\uD3ED\uD3EC/.test(compact) && !/\uCC9C\uC9C0/.test(compact)) {
    filtered = filtered.filter(value => {
      const name = normalizeDirectTerm(value.name);
      return name !== '\uCC9C\uC9C0' && name !== '\uBC31\uB450\uC0B0\uCC9C\uC9C0';
    });
  }

  const byNormalized = new Map<string, AttractionData>();
  for (const value of filtered) {
    const key = normalizeDirectTerm(value.name);
    if (!key) continue;
    const existing = byNormalized.get(key);
    if (!existing) {
      byNormalized.set(key, value);
      continue;
    }
    const existingScore = (text.includes(existing.name) ? 10 : 0) + (existing.name.includes(' ') ? 2 : 0) + existing.name.length / 100;
    const nextScore = (text.includes(value.name) ? 10 : 0) + (value.name.includes(' ') ? 2 : 0) + value.name.length / 100;
    if (nextScore > existingScore) byNormalized.set(key, value);
  }

  const unique = [...byNormalized.values()];
  return unique.filter(value => {
    const name = normalizeDirectTerm(value.name);
    return !unique.some(other => {
      if (other === value) return false;
      const otherName = normalizeDirectTerm(other.name);
      return otherName.length > name.length && otherName.includes(name);
    });
  });
}

function customerSafeAttractionNote(item: ItineraryScheduleItem, attraction?: AttractionData): string | null {
  const existing = typeof item.attraction_note === 'string' ? item.attraction_note.replace(/\s+/g, ' ').trim() : '';
  if (existing) return existing;

  const shortDesc = String(attraction?.short_desc ?? '').replace(/\s+/g, ' ').trim();
  if (shortDesc) return shortDesc;

  const note = typeof item.note === 'string' ? item.note.replace(/\s+/g, ' ').trim() : '';
  if (note && !isSupplierHeaderOrCommerceLine(note)) return note.slice(0, 140);

  const activity = String(item.activity ?? '').replace(/\s+/g, ' ').trim();
  if (!activity || isSupplierHeaderOrCommerceLine(activity) || isHotelStayLine(activity)) return null;
  return activity.slice(0, 140);
}

function findRegisteredAttractionTermsInText(
  text: string,
  attractions: AttractionData[],
  destination?: string,
): AttractionData[] {
  if (normalizeDirectTerm(text).length < 2) return [];

  const found = new Map<string, AttractionData>();
  const sorted = attractionsByLongestCanonicalName(attractions);
  for (const attraction of sorted) {
    for (const term of [attraction.name, ...(attraction.aliases ?? [])]) {
      if (!isDirectScanEligibleTerm(term, attraction, destination, text)) continue;
      if (!directTermOccurs(text, term)) continue;
      found.set(String(attraction.id ?? attraction.name), attraction);
      break;
    }
    if (found.size >= 5) break;
  }

  return [...found.values()];
}

function findPublicCanonicalAttractionNamesInText(
  text: string,
  attractions: AttractionData[],
): AttractionData[] {
  const compactText = normalizeDirectTerm(text);
  if (compactText.length < 2) return [];
  const found = new Map<string, AttractionData>();
  const index = publicCanonicalNameIndex(attractions);
  for (const length of index.lengths) {
    if (length > compactText.length) continue;
    for (let start = 0; start <= compactText.length - length; start++) {
      const attraction = index.byCompactName.get(compactText.slice(start, start + length));
      if (!attraction || !directTermOccurs(text, attraction.name)) continue;
      found.set(String(attraction.id ?? attraction.name), attraction);
      if (found.size >= 5) return [...found.values()];
    }
  }
  return [...found.values()];
}

function getAttractionQueries(item: ItineraryScheduleItem): string[] {
  const rawQueries = Array.isArray(item.attraction_queries)
    ? item.attraction_queries
    : typeof item.attraction_query === 'string'
      ? [item.attraction_query]
      : [];
  return rawQueries
    .map(query => String(query).replace(/\s+/g, ' ').trim())
    .filter(query => query.length >= 2);
}

function findUniquePublicAttractionsByInferredLabel(
  text: string,
  attractions: AttractionData[],
): AttractionData[] {
  const found = new Map<string, AttractionData>();
  for (const label of inferHighConfidenceAttractionLabels(text)) {
    const rawExact = attractions.filter(attraction => (
      isRecognizableAttractionMaster(attraction)
      && attraction.name.trim() === label
    ));
    const normalizedExact = rawExact.length > 0
      ? rawExact
      : attractions.filter(attraction => (
          isRecognizableAttractionMaster(attraction)
          && normalizeDirectTerm(attraction.name) === normalizeDirectTerm(label)
        ));
    if (normalizedExact.length !== 1) continue;
    const match = normalizedExact[0];
    found.set(String(match.id ?? match.name), match);
  }
  return [...found.values()];
}

function findMatchesForQueries(
  queries: string[],
  attractions: AttractionData[],
  destination?: string,
): AttractionData[] {
  const found = new Map<string, AttractionData>();
  for (const query of queries) {
    const scopedDirectMatches = findRegisteredAttractionTermsInText(query, attractions, destination);
    for (const direct of scopedDirectMatches) {
      found.set(String(direct.id ?? direct.name), direct);
    }
    if (scopedDirectMatches.length === 0) {
      for (const direct of findPublicCanonicalAttractionNamesInText(query, attractions)) {
        found.set(String(direct.id ?? direct.name), direct);
      }
    }
    for (const matched of matchAttractions(query, attractions, destination, { customerFacing: true })) {
      found.set(String(matched.id ?? matched.name), matched);
    }
  }
  return [...found.values()];
}

function isGenericNonAttractionActivity(activity: string): boolean {
  const text = activity.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const compact = text.replace(/\s+/g, '');
  if (/^(?:\uBD80\uC0B0|\uC138\uBD80|\uD074\uB77D|\uD478\uAFB8\uC625|\uB2E4\uB0AD|\uB098\uD2B8\uB791|\uC5F0\uAE38|\uB3C4\uBB38|\uC6A9\uC815|\uC774\uB3C4\uBC31\uD558|\uBD81\uD30C|\uC11C\uD30C)$/.test(compact)) return true;
  if (/^(?:살펴보기|여권|입국|이트래블|eTravel|만15세미만)/i.test(compact)) return true;
  if (isHotelOperationLine(text)) return true;
  if (/^(?:\uBBF8\uC81C\uACF5|\uBD88\uD3EC\uD568|\uD3EC\uD568|\uC81C\uACF5|\uC5C6\uC74C|N\/A|NA|-)$/.test(compact)) return true;
  if (/^(?:LJ|BX|KE|OZ|7C|ZE|TW|RS)\s*\d{3,4}$/i.test(text)) return true;
  if (/(?:출발|향발|도착|해산)/.test(text) && /(?:부산|세부|김해|공항)/.test(text)) return true;
  if (/기내박/.test(compact)) return true;
  if (/디스커버리\s*투어|시내관광|스쿠버다이빙|수영장\s*실습|오일마사지|호핑투어|자유시간|선택관광\s*즐기기/i.test(text)) return true;
  if (/로컬\s*마켓|재래\s*시장|대체될\s*수\s*있|비치바|핫플\s*카페/i.test(text)) return true;
  if (/(?:ETA|ESTA|필수\s*서류|유효기간|발급\s*(?:승인|후)|세관|전자세관|입국\s*시|입국\s*필수|출입국|신청\s*필수|QR\s*코드|전용\s*키오스크|미국\s*비자)/i.test(text)) return true;
  if (/(?:御膳|会席|海鮮鍋|焼\s*き|しゃぶしゃぶ|고젠|가이세키|회정식|일본코스요리|야채절임|된장국|해물전골|1인당|예약가능|실제\s*음식|조리\s*과정|플레이팅)/i.test(text)) return true;
  if (/(?:골프장|CC\b|라운딩|라운드\s*(?:전|후)|\d+\s*홀)/i.test(text)) return true;
  if (/기념품|토산품|건강보조식품|잡화|진주/.test(text)) return true;
  if (/^(?:\uC804\uC6A9\uCC28\uB7C9|\uC804\uC77C|\uACF5\uD56D\uC73C\uB85C\uC774\uB3D9|\uD638\uD154\uD22C\uC219\uBC0F\uD734\uC2DD)$/.test(compact)) return true;
  if (/^(?:\uC870|\uC911|\uC11D)\s*[:-]/.test(text)) return true;
  if (/^(?:\uD638\uD154\uC2DD|\uD604\uC9C0\uC2DD|\uAE40\uBC25|\uB0C9\uBA74|\uAFD4\uBC14\uB85C\uC6B0|\uC0E4\uBE0C\uC0E4\uBE0C|\uC0BC\uACB9\uC0B4|\uC591\uAF2C\uCE58|\uBE44\uBE54\uBC25|\uBB34\uC81C\uD55C|\uB9E4\uC6B4\uD0D5|\uC624\uB9AC\uAD6C\uC774|\uC0B0\uCC9C\uC5B4\uD68C)$/.test(compact)) return true;
  if (/^\$?\d+/.test(text)) return true;
  if (/(관광|방문|투어|입장|관람|탐방|체험)/.test(text)) return false;
  return /(?:자유\s*시간|시내\s*자유|공항\s*이동|호텔\s*휴식|휴식|수속|미팅|도착|출발)$/.test(text)
    || /^(?:공항|호텔|리조트|기내|차량)\s*(?:이동|휴식|수속|미팅|도착|출발)/.test(text);
}

export function shouldAttemptAttractionMatch(item: ItineraryScheduleItem): boolean {
  if (!item.activity) return false;
  if (shouldStripAttractionReferences(item)) return false;
  if (item.entity_kind === 'transfer' || item.entity_kind === 'hotel_stay' || item.entity_kind === 'meal') return false;
  if (item.type && SKIP_TYPES.has(item.type)) return false;
  const text = [item.activity, item.note ?? ''].filter(Boolean).join(' ');
  if (isGenericNonAttractionActivity(item.activity)) return false;
  if (MINIMUM_ACTIVITY_HINT_RE.test(text)) {
    return extractAttractionCandidates(item.activity, item.note).length > 0;
  }
  return extractAttractionCandidates(item.activity, item.note).length > 0;
}

/**
 * 일정표 schedule 항목에 attraction 메타를 주입한다.
 * - attraction_ids / attraction_names: 고객 노출/검증용 정형 키
 * - attraction_note: 첫 매칭 관광지 short_desc (렌더 기본값)
 */
export function enrichItineraryWithAttractionReferences(
  itineraryData: ItineraryDataLike | null,
  attractions: AttractionData[],
  destination?: string,
): EnrichResult {
  if (!itineraryData?.days?.length || attractions.length === 0) {
    return { itineraryData, matchedCanonicalNames: [], matchedScheduleItemCount: 0, unmatchedCandidates: [] };
  }

  const matchedNames = new Set<string>();
  let matchedScheduleItemCount = 0;
  const unmatched: { activity: string; day_number: number }[] = [];
  const attractionById = new Map(attractions.map(a => [String(a.id), a]));

  const days = itineraryData.days.map((day) => {
    const dayRegions = Array.isArray(day.regions)
      ? day.regions.map(region => String(region)).filter(Boolean)
      : [];
    const matchDestination = [destination, ...dayRegions].filter(Boolean).join('/');
    const schedule = (day.schedule ?? []).map((originalItem) => {
      let item = originalItem;
      if (item.type && SKIP_TYPES.has(item.type)) return removeAttractionReferences(item);
      if (shouldStripAttractionReferences(item)) return removeAttractionReferences(item);
      const itemText = [item.activity, item.note ?? ''].filter(Boolean).join(' ');
      const existingIds = Array.isArray(item.attraction_ids)
        ? item.attraction_ids.map(id => String(id)).filter(Boolean)
        : [];
      if (existingIds.length > 0) {
        const directValues = dedupeAttractionMatches(
          findRegisteredAttractionTermsInText(itemText, attractions, matchDestination),
          itemText,
        );
        if (directValues.length > 0) {
          matchedScheduleItemCount++;
          directValues.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: directValues.map(v => v.id).filter(Boolean),
            attraction_names: directValues.map(v => v.name),
            attraction_note: customerSafeAttractionNote(item, directValues[0]),
          };
        }
        const rawValues = existingIds
          .map(id => attractionById.get(id))
          .filter((a): a is AttractionData => Boolean(a))
          .filter(isSightseeingAttractionRow)
          .filter(a => destinationAllowsAttraction(a, matchDestination));
        const values = dedupeAttractionMatches(rawValues, itemText);
        if (values.length > 0) {
          matchedScheduleItemCount++;
          values.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: values.map(v => v.id).filter(Boolean),
            attraction_names: values.map(v => v.name),
            attraction_note: customerSafeAttractionNote(item, values[0]),
          };
        }
        // A previous parser or enrichment pass can leave a stale/out-of-scope
        // id on an otherwise valid customer attraction. Strip that reference
        // and continue through the same evidence-backed matching flow instead
        // of turning the row into a permanent false negative.
        item = removeAttractionReferences(item);
      }

      let pendingCompiledQueryUnmatched: string | null = null;
      const compiledQueries = getAttractionQueries(item);
      if (compiledQueries.length > 0) {
        const values = dedupeAttractionMatches(
          findMatchesForQueries(compiledQueries, attractions, matchDestination),
          [itemText, ...compiledQueries].filter(Boolean).join(' '),
        );
        if (values.length === 0) {
          pendingCompiledQueryUnmatched = compiledQueries[0] ?? null;
        } else {
          matchedScheduleItemCount++;
          values.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: values.map(v => v.id).filter(Boolean),
            attraction_names: values.map(v => v.name),
            attraction_note: customerSafeAttractionNote(item, values[0]),
          };
        }
      }

      const inferredCanonicalMatches = findUniquePublicAttractionsByInferredLabel(itemText, attractions);
      if (inferredCanonicalMatches.length > 0) {
        const values = dedupeAttractionMatches(inferredCanonicalMatches, itemText);
        if (values.length > 0) {
          matchedScheduleItemCount++;
          values.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: values.map(v => v.id).filter(Boolean),
            attraction_names: values.map(v => v.name),
            attraction_note: customerSafeAttractionNote(item, values[0]),
          };
        }
      }

      const publicCanonicalMatches = findPublicCanonicalAttractionNamesInText(itemText, attractions);
      if (publicCanonicalMatches.length > 0) {
        const values = dedupeAttractionMatches(publicCanonicalMatches, itemText);
        if (values.length > 0) {
          matchedScheduleItemCount++;
          values.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: values.map(v => v.id).filter(Boolean),
            attraction_names: values.map(v => v.name),
            attraction_note: customerSafeAttractionNote(item, values[0]),
          };
        }
      }

      const noteHasAttractionHint = /(산|궁|공원|호수|폭포|사원|성당|교회|광장|마을|전망|유적|박물관|시장|민속촌)/.test(item.note ?? '');
      if (isDirectScanUnsafeActivity(item.activity) && !noteHasAttractionHint) return item;
      const scopedDirectMatches = findRegisteredAttractionTermsInText(
        itemText,
        attractions,
        matchDestination,
      );
      const directMatches = scopedDirectMatches.length > 0
        ? scopedDirectMatches
        : publicCanonicalMatches;
      if (directMatches.length > 0) {
        const values = dedupeAttractionMatches(directMatches, itemText);
        if (values.length === 0) return removeAttractionReferences(item);
        matchedScheduleItemCount++;
        values.forEach(v => matchedNames.add(v.name));
        return {
          ...item,
          attraction_ids: values.map(v => v.id).filter(Boolean),
          attraction_names: values.map(v => v.name),
          attraction_note: customerSafeAttractionNote(item, values[0]),
        };
      }

      if (!shouldAttemptAttractionMatch(item)) {
        return removeAttractionReferences(item);
      }
      const candidates = extractAttractionCandidates(item.activity, item.note);
      if (candidates.length === 0) {
        if (pendingCompiledQueryUnmatched) unmatched.push({ activity: pendingCompiledQueryUnmatched, day_number: day.day ?? 0 });
        return item;
      }

      const found = new Map<string, AttractionData>();
      for (const c of candidates) {
        const matches = matchAttractions(c, attractions, matchDestination);
        for (const m of matches) {
          const key = (m.id ?? m.name).toString();
          found.set(key, m);
        }
        if (matches.length === 0) {
          for (const m of findPublicCanonicalAttractionNamesInText(c, attractions)) {
            const key = (m.id ?? m.name).toString();
            found.set(key, m);
          }
        }
      }

      if (found.size === 0) {
        unmatched.push({ activity: pendingCompiledQueryUnmatched ?? candidates[0], day_number: day.day ?? 0 });
        return item;
      }

      const values = dedupeAttractionMatches([...found.values()], itemText);
      if (values.length === 0) return removeAttractionReferences(item);
      matchedScheduleItemCount++;
      values.forEach(v => matchedNames.add(v.name));
      return {
        ...item,
        attraction_ids: values.map(v => v.id).filter(Boolean),
        attraction_names: values.map(v => v.name),
        attraction_note: customerSafeAttractionNote(item, values[0]),
      };
    });

    return { ...day, schedule };
  });

  return {
    itineraryData: { ...itineraryData, days },
    matchedCanonicalNames: [...matchedNames],
    matchedScheduleItemCount,
    unmatchedCandidates: unmatched,
  };
}
