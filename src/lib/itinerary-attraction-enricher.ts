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
  unmatchedCandidates: { activity: string; day_number: number }[];
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
    return { itineraryData, matchedCanonicalNames: [], unmatchedCandidates: [] };
  }

  const matchedNames = new Set<string>();
  const unmatched: { activity: string; day_number: number }[] = [];

  const days = itineraryData.days.map((day) => {
    const schedule = (day.schedule ?? []).map((item) => {
      if (!item.activity || item.type === 'flight' || item.type === 'hotel') return item;
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
    unmatchedCandidates: unmatched,
  };
}
