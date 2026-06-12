import { matchAttractions, type AttractionData } from '@/lib/attraction-matcher';
import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';

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

const SKIP_TYPES = new Set(['flight', 'hotel', 'shopping', 'meal']);
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
  const dest = normalizeDirectTerm(destination);
  if (!dest) return true;
  const region = normalizeDirectTerm(attraction.region);
  if (region) {
    const regionTokens = region.split(/[,/|&]+/).map(token => token.trim()).filter(Boolean);
    return dest.includes(region) || region.includes(dest) || regionTokens.some(token => token.length >= 2 && dest.includes(token));
  }
  return true;
}

function directTermOccurs(text: string, term: string): boolean {
  const clean = term.trim().toLowerCase();
  if (!clean) return false;
  const compact = clean.replace(/\s+/g, '');
  if (compact.length <= 2) return hasTermBoundary(text.toLowerCase(), clean);
  return normalizeDirectTerm(text).includes(compact);
}

function isDirectScanEligibleTerm(term: string, attraction: AttractionData, destination?: string): boolean {
  const clean = term.trim();
  if (clean.length < 2 || clean.length > 24) return false;
  if (DIRECT_SCAN_STOP_TERMS.has(clean)) return false;
  if (attraction.category && DIRECT_SCAN_EXCLUDED_CATEGORIES.has(attraction.category)) return false;
  if (!destinationAllowsAttraction(attraction, destination) && normalizeDirectTerm(clean).length < 4) return false;
  return true;
}

function isDirectScanUnsafeActivity(activity: string): boolean {
  const compact = activity.replace(/\s+/g, '');
  if (!compact) return true;
  if (/(?:\uB9C8\uC0AC\uC9C0|\uC774\uB3D9|\uC18C\uC694|\uD638\uD154|\uACF5\uD56D|\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD|\uAC00\uC774\uB4DC\uBBF8\uD305)/.test(compact)) {
    return !/(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C)/.test(compact);
  }
  return false;
}

function compactScheduleText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '');
}

function hasAttractionVisitHint(text: string): boolean {
  const compact = compactScheduleText(text);
  return /(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uC77C\uC1A1\uC815|\uD574\uB780\uAC15|\uCC9C\uC9C0|\uC628\uCC9C\uC9C0\uB300|\uACBD\uACC4\uBE44|\uB300\uD611\uACE1|\uACE0\uC0B0\uD654\uC6D0)/.test(compact);
}

function isSupplierHeaderOrCommerceLine(text: string): boolean {
  const compact = compactScheduleText(text);
  return /(?:\uD604\uC9C0\uC9C0\uBD88\uC635\uC158|\uC120\uD0DD\uAD00\uAD11|\uCD9C\uBC1C\uC99D\uD3B8|\uCD9C\uBC1C\uC77C|\uC0C1\uD488\uAC00|\uC694\uAE08\uD45C|\uD328\uD134|\uB178\uC635\uC158|\uB178\uC1FC\uD551|\uB178\uD301)/.test(compact)
    || /(?:\$|\uFF04)\s*\d/.test(text)
    || /(?:\uBAA9\uC694\uC77C|\uC77C\uC694\uC77C)\d*\uBC15\d*\uC77C/.test(compact);
}

function shouldStripAttractionReferences(item: ItineraryScheduleItem): boolean {
  const text = [item.activity, item.note ?? ''].filter(Boolean).join(' ');
  if (isSupplierHeaderOrCommerceLine(text)) return true;
  if (item.entity_kind === 'optional_tour' || item.entity_kind === 'perk') return true;
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
  let filtered = values;

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
    if (name.length <= 2) {
      return !unique.some(other => {
        if (other === value) return false;
        const otherName = normalizeDirectTerm(other.name);
        return otherName.length > name.length && otherName.includes(name);
      });
    }
    return true;
  });
}

function findRegisteredAttractionTermsInText(
  text: string,
  attractions: AttractionData[],
  destination?: string,
): AttractionData[] {
  if (normalizeDirectTerm(text).length < 2) return [];

  const found = new Map<string, AttractionData>();
  const sorted = attractions.slice().sort((a, b) => normalizeDirectTerm(b.name).length - normalizeDirectTerm(a.name).length);
  for (const attraction of sorted) {
    for (const term of [attraction.name, ...(attraction.aliases ?? [])]) {
      if (!isDirectScanEligibleTerm(term, attraction, destination)) continue;
      if (!directTermOccurs(text, term)) continue;
      found.set(String(attraction.id ?? attraction.name), attraction);
      break;
    }
    if (found.size >= 5) break;
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

function findMatchesForQueries(
  queries: string[],
  attractions: AttractionData[],
  destination?: string,
): AttractionData[] {
  const found = new Map<string, AttractionData>();
  for (const query of queries) {
    for (const direct of findRegisteredAttractionTermsInText(query, attractions, destination)) {
      found.set(String(direct.id ?? direct.name), direct);
    }
    for (const matched of matchAttractions(query, attractions, destination)) {
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
  if (/^(?:LJ|BX|KE|OZ|7C|ZE|TW|RS)\s*\d{3,4}$/i.test(text)) return true;
  if (/(?:출발|향발|도착|해산)/.test(text) && /(?:부산|세부|김해|공항)/.test(text)) return true;
  if (/기내박/.test(compact)) return true;
  if (/디스커버리\s*투어|시내관광|스쿠버다이빙|수영장\s*실습|오일마사지|호핑투어|자유시간|선택관광\s*즐기기/i.test(text)) return true;
  if (/기념품|토산품|건강보조식품|잡화|진주/.test(text)) return true;
  if (/^(?:\uC804\uC6A9\uCC28\uB7C9|\uC804\uC77C|\uACF5\uD56D\uC73C\uB85C\uC774\uB3D9|\uD638\uD154\uD22C\uC219\uBC0F\uD734\uC2DD)$/.test(compact)) return true;
  if (/^(?:\uC870|\uC911|\uC11D)\s*:/.test(text)) return true;
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
  if (MINIMUM_ACTIVITY_HINT_RE.test(text)) {
    return extractAttractionCandidates(item.activity, item.note).length > 0;
  }
  if (isGenericNonAttractionActivity(item.activity)) return false;
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
    const schedule = (day.schedule ?? []).map((item) => {
      if (item.type && SKIP_TYPES.has(item.type)) return item;
      if (shouldStripAttractionReferences(item)) return removeAttractionReferences(item);
      const existingIds = Array.isArray(item.attraction_ids)
        ? item.attraction_ids.map(id => String(id)).filter(Boolean)
        : [];
      if (existingIds.length > 0) {
        const rawValues = existingIds
          .map(id => attractionById.get(id))
          .filter((a): a is AttractionData => Boolean(a))
          .filter(a => destinationAllowsAttraction(a, matchDestination));
        const values = dedupeAttractionMatches(rawValues, [item.activity, item.note ?? ''].filter(Boolean).join(' '));
        if (values.length > 0) {
          matchedScheduleItemCount++;
          values.forEach(v => matchedNames.add(v.name));
          return {
            ...item,
            attraction_ids: values.map(v => v.id).filter(Boolean),
            attraction_names: values.map(v => v.name),
            attraction_note: values[0]?.short_desc ?? item.note ?? null,
          };
        }
        unmatched.push({ activity: item.activity, day_number: day.day ?? 0 });
        return removeAttractionReferences(item);
      }

      const compiledQueries = getAttractionQueries(item);
      if (compiledQueries.length > 0) {
        const values = dedupeAttractionMatches(
          findMatchesForQueries(compiledQueries, attractions, matchDestination),
          [item.activity, item.note ?? '', ...compiledQueries].filter(Boolean).join(' '),
        );
        if (values.length === 0) {
          unmatched.push({ activity: compiledQueries[0], day_number: day.day ?? 0 });
          return item;
        }
        matchedScheduleItemCount++;
        values.forEach(v => matchedNames.add(v.name));
        return {
          ...item,
          attraction_ids: values.map(v => v.id).filter(Boolean),
          attraction_names: values.map(v => v.name),
          attraction_note: values[0]?.short_desc ?? item.note ?? null,
        };
      }

      const noteHasAttractionHint = /(산|궁|공원|호수|폭포|사원|성당|교회|광장|마을|전망|유적|박물관|시장|민속촌)/.test(item.note ?? '');
      if (isDirectScanUnsafeActivity(item.activity) && !noteHasAttractionHint) return item;
      const directMatches = findRegisteredAttractionTermsInText(
        [item.activity, item.note ?? ''].filter(Boolean).join(' '),
        attractions,
        matchDestination,
      );
      if (directMatches.length > 0) {
        const values = dedupeAttractionMatches(directMatches, [item.activity, item.note ?? ''].filter(Boolean).join(' '));
        if (values.length === 0) return removeAttractionReferences(item);
        matchedScheduleItemCount++;
        values.forEach(v => matchedNames.add(v.name));
        return {
          ...item,
          attraction_ids: values.map(v => v.id).filter(Boolean),
          attraction_names: values.map(v => v.name),
          attraction_note: values[0]?.short_desc ?? item.note ?? null,
        };
      }

      if (!shouldAttemptAttractionMatch(item)) return item;
      const candidates = extractAttractionCandidates(item.activity, item.note);
      if (candidates.length === 0) return item;

      const found = new Map<string, AttractionData>();
      for (const c of candidates) {
        const matches = matchAttractions(c, attractions, matchDestination);
        for (const m of matches) {
          const key = (m.id ?? m.name).toString();
          found.set(key, m);
        }
      }

      if (found.size === 0) {
        unmatched.push({ activity: candidates[0], day_number: day.day ?? 0 });
        return item;
      }

      const values = dedupeAttractionMatches([...found.values()], [item.activity, item.note ?? ''].filter(Boolean).join(' '));
      if (values.length === 0) return removeAttractionReferences(item);
      matchedScheduleItemCount++;
      values.forEach(v => matchedNames.add(v.name));
      return {
        ...item,
        attraction_ids: values.map(v => v.id).filter(Boolean),
        attraction_names: values.map(v => v.name),
        attraction_note: values[0]?.short_desc ?? item.note ?? null,
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
