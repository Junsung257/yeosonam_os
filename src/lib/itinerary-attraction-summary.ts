export interface ItinerarySummaryLike {
  days?: Array<{
    schedule?: Array<{
      attraction_names?: string[] | null;
      attraction_ids?: string[] | null;
      entity_kind?: string | null;
      type?: string | null;
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

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function hasAttractionEvidence(schedule: {
  attraction_ids?: string[] | null;
  attraction_names?: string[] | null;
  entity_kind?: string | null;
  type?: string | null;
}): boolean {
  const kind = `${schedule.entity_kind ?? schedule.type ?? ''}`.toLowerCase();
  return kind === 'attraction_visit'
    || kind === 'attraction'
    || (schedule.attraction_ids?.filter(Boolean).length ?? 0) > 0;
}

function isKnownNonAttractionKind(schedule: {
  entity_kind?: string | null;
  type?: string | null;
}): boolean {
  const kind = `${schedule.entity_kind ?? schedule.type ?? ''}`.toLowerCase();
  return /meal|transfer|hotel|free_time|optional|perk|shopping|notice|unknown/.test(kind);
}

function isNonAttractionActivity(text: string): boolean {
  return /^(호텔|조식|중식|석식|이동|출발|도착|휴식|라운딩|공항|meal|transfer|hotel)/i.test(text);
}

/**
 * Return customer-facing attraction preview names from itinerary_data.
 * Never promote generic schedule text such as meals, transfers, airport lines,
 * or golf meal fragments as an attraction preview.
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
    for (const schedule of day.schedule ?? []) {
      const evidence = hasAttractionEvidence(schedule);
      const names = schedule.attraction_names?.filter(Boolean) ?? [];

      if (names.length > 0) {
        if (!evidence && isKnownNonAttractionKind(schedule)) continue;
        for (const name of names) {
          const key = normalizedKey(name);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(name);
          if (out.length >= max) return out;
        }
        continue;
      }

      if (!evidence) continue;
      const activity = (schedule.activity ?? '').replace(/^▶\s*/, '').trim();
      if (!activity || isNonAttractionActivity(activity)) continue;
      const fallback = activity.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();
      if (fallback.length < 2 || fallback.length > 24) continue;
      const key = normalizedKey(fallback);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fallback);
      if (out.length >= max) return out;
    }
  }
  return out;
}
