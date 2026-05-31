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

function isGenericNonAttractionActivity(activity: string): boolean {
  const text = activity.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/(관광|방문|투어|입장|관람|탐방|체험)/.test(text)) return false;
  return /(?:자유\s*시간|시내\s*자유|공항\s*이동|호텔\s*휴식|휴식|수속|미팅|도착|출발)$/.test(text)
    || /^(?:공항|호텔|리조트|기내|차량)\s*(?:이동|휴식|수속|미팅|도착|출발)/.test(text);
}

export function shouldAttemptAttractionMatch(item: ItineraryScheduleItem): boolean {
  if (!item.activity) return false;
  if (item.type && SKIP_TYPES.has(item.type)) return false;
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
      if (!shouldAttemptAttractionMatch(item)) return item;
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
