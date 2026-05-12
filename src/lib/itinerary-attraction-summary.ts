export interface ItinerarySummaryLike {
  days?: Array<{
    schedule?: Array<{
      attraction_names?: string[] | null;
      activity?: string;
    }>;
  }>;
}

function normalizeItinerary(input: unknown): ItinerarySummaryLike | null {
  if (!input) return null;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as ItinerarySummaryLike;
    } catch {
      return null;
    }
  }
  if (typeof input === 'object') return input as ItinerarySummaryLike;
  return null;
}

/**
 * itinerary_data에서 관광지 프리뷰 이름을 중복 제거해 반환.
 * 우선순위: attraction_names[] -> 없으면 activity(▶ 제거) fallback.
 */
export function getAttractionPreviewNamesFromItinerary(
  itineraryData: unknown,
  max = 5,
): string[] {
  const it = normalizeItinerary(itineraryData);
  if (!it?.days?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const day of it.days) {
    for (const s of day.schedule ?? []) {
      const names = s.attraction_names?.filter(Boolean) ?? [];
      if (names.length > 0) {
        for (const name of names) {
          const key = name.toLowerCase().replace(/\s+/g, '');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(name);
          if (out.length >= max) return out;
        }
        continue;
      }

      const activity = (s.activity ?? '').replace(/^▶\s*/, '').trim();
      if (!activity || /^(호텔|조식|중식|석식|이동|출발|도착|휴식)/.test(activity)) continue;
      const fallback = activity.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();
      if (fallback.length < 2 || fallback.length > 24) continue;
      const key = fallback.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fallback);
      if (out.length >= max) return out;
    }
  }
  return out;
}
