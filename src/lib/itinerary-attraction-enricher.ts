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
const DIRECT_SCAN_EXCLUDED_CATEGORIES = new Set(['accommodation', 'mrt_product']);
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

function isDirectScanEligibleTerm(term: string, attraction: AttractionData): boolean {
  const clean = term.trim();
  if (clean.length < 2 || clean.length > 24) return false;
  if (DIRECT_SCAN_STOP_TERMS.has(clean)) return false;
  if (attraction.category && DIRECT_SCAN_EXCLUDED_CATEGORIES.has(attraction.category)) return false;
  return true;
}

function findRegisteredAttractionTermsInText(
  text: string,
  attractions: AttractionData[],
): AttractionData[] {
  const normalizedText = normalizeDirectTerm(text);
  if (normalizedText.length < 2) return [];

  const found = new Map<string, AttractionData>();
  const sorted = attractions.slice().sort((a, b) => normalizeDirectTerm(b.name).length - normalizeDirectTerm(a.name).length);
  for (const attraction of sorted) {
    for (const term of [attraction.name, ...(attraction.aliases ?? [])]) {
      if (!isDirectScanEligibleTerm(term, attraction)) continue;
      if (!normalizedText.includes(normalizeDirectTerm(term))) continue;
      found.set(String(attraction.id ?? attraction.name), attraction);
      break;
    }
    if (found.size >= 5) break;
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
    const schedule = (day.schedule ?? []).map((item) => {
      if (item.type && SKIP_TYPES.has(item.type)) return item;
      const existingIds = Array.isArray(item.attraction_ids)
        ? item.attraction_ids.map(id => String(id)).filter(Boolean)
        : [];
      if (existingIds.length > 0) {
        const values = existingIds.map(id => attractionById.get(id)).filter((a): a is AttractionData => Boolean(a));
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
        return { ...item, attraction_ids: [] };
      }

      const directMatches = findRegisteredAttractionTermsInText(
        [item.activity, item.note ?? ''].filter(Boolean).join(' '),
        attractions,
      );
      if (directMatches.length > 0) {
        const values = directMatches;
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
        const matches = matchAttractions(c, attractions, destination);
        for (const m of matches) {
          const key = (m.id ?? m.name).toString();
          found.set(key, m);
        }
      }

      if (found.size === 0) {
        unmatched.push({ activity: candidates[0], day_number: day.day ?? 0 });
        return item;
      }

      const values = [...found.values()];
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
