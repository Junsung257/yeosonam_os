import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';
import type { AttractionData } from '@/lib/attraction-matcher';
import {
  enrichItineraryWithAttractionReferences,
  shouldAttemptAttractionMatch,
  type ItineraryDataLike,
  type ItineraryDayLike,
} from '@/lib/itinerary-attraction-enricher';
import { postProcessItineraryData } from '@/lib/package-post-process';
import {
  findItineraryScheduleQualityIssues,
  type ItineraryScheduleQualityDay,
} from './itinerary-quality-gate';
import { compileItineraryForLanding } from '@/lib/itinerary-schedule-compiler';
import { mergeRawTextMealEvidence, normalizeStructuredItineraryEntities } from '@/lib/itinerary-structured-entities';

export type { ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';

export type UploadItineraryNormalizationResult = {
  itineraryInput: ItineraryDataLike | null;
  itineraryDataToSave: ItineraryDataLike | null;
  scheduleItemCount: number;
  matchedScheduleItemCount: number;
  unmatchedCandidateCount: number;
  unmatchedCandidates: Array<{ activity: string; day_number: number }>;
  matchedCanonicalNames: string[];
  extractedCandidateRows: Array<{ activity: string; destination?: string }>;
  fallbackApplied: boolean;
  fallbackAirline?: string | null;
  removedPollutedScheduleItems: Array<{ day: number | null; activity: string; reason: string }>;
  warnings: string[];
};

function extractCatalogShoppingForRender(rawText: string | null | undefined): string | null {
  const raw = rawText?.match(/쇼핑센터\s*\n([\s\S]*?)(?=비\s*고|일\s*자)/)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim();
  return raw ? `쇼핑센터 ${raw}` : null;
}

function attachShoppingHighlight<T extends ItineraryDataLike | null>(itineraryData: T, shoppingText: string | null): T {
  if (!itineraryData || !shoppingText) return itineraryData;
  const obj = itineraryData as ItineraryDataLike & { highlights?: Record<string, unknown> };
  const highlights = obj.highlights && typeof obj.highlights === 'object' ? obj.highlights : {};
  if (typeof highlights.shopping === 'string' && highlights.shopping.trim()) return itineraryData;
  return {
    ...obj,
    highlights: {
      ...highlights,
      shopping: shoppingText,
    },
  } as unknown as T;
}

function topLevelFlightSegments(itineraryData: ItineraryDataLike | null | undefined): unknown[] | null {
  const segments = (itineraryData as { flight_segments?: unknown } | null | undefined)?.flight_segments;
  return Array.isArray(segments) && segments.length > 0 ? segments : null;
}

function preserveTopLevelFlightSegments<T extends ItineraryDataLike | null>(
  itineraryData: T,
  source: ItineraryDataLike | null | undefined,
): T {
  if (!itineraryData) return itineraryData;
  const existing = topLevelFlightSegments(itineraryData);
  if (existing) return itineraryData;
  const sourceSegments = topLevelFlightSegments(source);
  if (!sourceSegments) return itineraryData;
  return {
    ...itineraryData,
    flight_segments: sourceSegments,
  } as T;
}

function activityKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function dayNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function dayCompletenessScore(day: ItineraryDayLike): number {
  const schedule = Array.isArray(day.schedule) ? day.schedule : [];
  const text = JSON.stringify({
    schedule,
    hotel: day.hotel ?? null,
    meals: day.meals ?? null,
  });
  const hotelBonus = day.hotel && typeof day.hotel === 'object' ? 20 : 0;
  const mealsBonus = day.meals && typeof day.meals === 'object' ? 20 : 0;
  return schedule.length * 100 + text.length + hotelBonus + mealsBonus;
}

function collapseDuplicateDayEntries<T extends ItineraryDataLike | null>(itineraryData: T, durationDays?: number | null): {
  itineraryData: T;
  warnings: string[];
} {
  const days = itineraryData?.days;
  if (!days?.length) return { itineraryData, warnings: [] };

  const numbered = days.map((day, index) => ({ day, index, number: dayNumber(day.day) }));
  const validNumbers = numbered
    .map(row => row.number)
    .filter((value): value is number => value !== null);
  const uniqueNumbers = new Set(validNumbers);
  if (uniqueNumbers.size === validNumbers.length) return { itineraryData, warnings: [] };

  const maxNumber = Math.max(...uniqueNumbers);
  const boundedByDuration = typeof durationDays === 'number' && durationDays > 0;
  if (boundedByDuration && (uniqueNumbers.size > durationDays || maxNumber > durationDays)) {
    return { itineraryData, warnings: [] };
  }

  const grouped = new Map<number, typeof numbered>();
  for (const row of numbered) {
    if (row.number === null) continue;
    grouped.set(row.number, [...(grouped.get(row.number) ?? []), row]);
  }

  const bestByNumber = new Map<number, typeof numbered[number]>();
  for (const [number, rows] of grouped.entries()) {
    const best = [...rows].sort((a, b) => {
      const scoreDelta = dayCompletenessScore(b.day) - dayCompletenessScore(a.day);
      return scoreDelta !== 0 ? scoreDelta : a.index - b.index;
    })[0];
    bestByNumber.set(number, best);
  }

  const seen = new Set<number>();
  const collapsed = numbered.flatMap(row => {
    if (row.number === null) return [row.day];
    if (seen.has(row.number)) return [];
    seen.add(row.number);
    return [bestByNumber.get(row.number)?.day ?? row.day];
  });

  const duplicateNumbers = [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([number]) => number)
    .sort((a, b) => a - b);

  return {
    itineraryData: { ...itineraryData, days: collapsed } as T,
    warnings: [
      `duplicate itinerary days collapsed: day ${duplicateNumbers.join(', ')}`,
    ],
  };
}

function looksLikePriceTableDay(day: ItineraryDayLike): boolean {
  const schedule = Array.isArray(day.schedule) ? day.schedule : [];
  const text = schedule
    .map(item => activityKey((item as { activity?: unknown }).activity))
    .filter(Boolean)
    .join(' ');
  if (!text) return true;
  const hasFlightOrHotel = schedule.some(item => {
    const row = item as { type?: unknown; transport?: unknown; activity?: unknown };
    return row.type === 'flight'
      || row.type === 'hotel'
      || (typeof row.transport === 'string' && /^[A-Z]{2}\d{2,4}$/.test(row.transport))
      || /HOTEL|호텔|공항|출발|도착/.test(String(row.activity ?? ''));
  });
  if (hasFlightOrHotel) return false;
  const priceLikeCount = (text.match(/\d{1,2}\s*(?:월)?\s*\d{1,2}|[1-9]\d{0,2},\d{3}/g) ?? []).length;
  const lowSignalCount = schedule.filter(item => {
    const activity = activityKey((item as { activity?: unknown }).activity);
    return !activity || activity === ':' || activity === 'OR' || /^\(?\s*\d+\s*\)?\.?$/.test(activity);
  }).length;
  return priceLikeCount >= 2 || lowSignalCount >= Math.max(2, Math.floor(schedule.length / 2));
}

function pruneOutOfRangePollutedDays<T extends ItineraryDataLike | null>(itineraryData: T, durationDays?: number | null): {
  itineraryData: T;
  warnings: string[];
} {
  if (!itineraryData?.days?.length || typeof durationDays !== 'number' || durationDays <= 0) {
    return { itineraryData, warnings: [] };
  }
  const removed: number[] = [];
  const days = itineraryData.days.filter(day => {
    const number = dayNumber(day.day);
    if (number === null || number <= durationDays) return true;
    if (!looksLikePriceTableDay(day)) return true;
    removed.push(number);
    return false;
  });
  if (removed.length === 0) return { itineraryData, warnings: [] };
  return {
    itineraryData: { ...itineraryData, days } as T,
    warnings: [`out-of-range polluted itinerary days pruned: day ${[...new Set(removed)].sort((a, b) => a - b).join(', ')}`],
  };
}

function prunePollutedScheduleItems<T extends ItineraryDataLike | null>(itineraryData: T): {
  itineraryData: T;
  removed: Array<{ day: number | null; activity: string; reason: string }>;
} {
  if (!itineraryData?.days?.length) return { itineraryData, removed: [] };

  let changed = false;
  const removed: Array<{ day: number | null; activity: string; reason: string }> = [];
  const days = itineraryData.days.map(day => {
    const issues = findItineraryScheduleQualityIssues([day as ItineraryScheduleQualityDay]);
    if (issues.length === 0) return day;

    const hotelIssue = issues.find(issue => issue.code === 'ITINERARY_HOTEL_FIELD_SCHEDULE_TEXT');
    const scheduleIssues = issues.filter(issue => issue.code !== 'ITINERARY_HOTEL_FIELD_SCHEDULE_TEXT');
    const pollutedActivities = new Set(scheduleIssues.map(issue => activityKey(issue.activity)));
    const scheduleItems = Array.isArray(day.schedule) ? day.schedule : null;
    const schedule = scheduleItems
      ? scheduleItems.filter(item => !pollutedActivities.has(activityKey(item.activity)))
      : null;
    const scheduleChanged = Boolean(scheduleItems && schedule && schedule.length !== scheduleItems.length);
    const hotelChanged = Boolean(hotelIssue && day.hotel);
    if (!scheduleChanged && !hotelChanged) return day;

    changed = true;
    removed.push(...issues.map(issue => ({
      day: issue.day,
      activity: issue.activity,
      reason: issue.reason,
    })));
    return {
      ...day,
      ...(scheduleChanged ? { schedule } : {}),
      ...(hotelChanged ? { hotel: null } : {}),
    };
  });

  return {
    itineraryData: changed ? ({ ...itineraryData, days } as T) : itineraryData,
    removed,
  };
}

export async function normalizeUploadItinerary(input: {
  itineraryData?: ItineraryDataLike | null;
  productRawText?: string | null;
  destination?: string | null;
  durationDays?: number | null;
  activeAttractions: AttractionData[];
}): Promise<UploadItineraryNormalizationResult> {
  const warnings: string[] = [];
  let itineraryInput = input.itineraryData ?? null;
  let fallbackApplied = false;
  let fallbackAirline: string | null = null;

  if (!itineraryInput?.days?.length && input.productRawText) {
    try {
      const { parseDayTable } = await import('@/lib/parser/deterministic/day-table');
      const detResult = parseDayTable(input.productRawText);
      if (detResult.days.length > 0 && detResult.confidence >= 0.4) {
        itineraryInput = detResult as unknown as ItineraryDataLike;
        fallbackApplied = true;
        fallbackAirline = detResult.meta.airline ?? null;
      }
    } catch (e) {
      warnings.push(`day-table fallback 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  itineraryInput = normalizeStructuredItineraryEntities(itineraryInput);
  const initialPrune = prunePollutedScheduleItems(itineraryInput);
  const initialRangeRepair = pruneOutOfRangePollutedDays(initialPrune.itineraryData, input.durationDays);
  warnings.push(...initialRangeRepair.warnings);
  const initialDuplicateRepair = collapseDuplicateDayEntries(initialRangeRepair.itineraryData, input.durationDays);
  warnings.push(...initialDuplicateRepair.warnings);
  itineraryInput = compileItineraryForLanding(initialDuplicateRepair.itineraryData);

  const enrichment = enrichItineraryWithAttractionReferences(
    itineraryInput,
    input.activeAttractions,
    input.destination ?? undefined,
  );

  let scheduleItemCount = 0;
  for (const day of itineraryInput?.days ?? []) {
    for (const s of day.schedule ?? []) {
      if (shouldAttemptAttractionMatch(s as { activity: string; note?: string | null; type?: string })) {
        scheduleItemCount++;
      }
    }
  }

  const finalPrune = prunePollutedScheduleItems(
    compileItineraryForLanding(
      (postProcessItineraryData(enrichment.itineraryData ?? itineraryInput ?? input.itineraryData ?? null) ?? null) as ItineraryDataLike | null,
    ),
  );
  const postMergePrune = prunePollutedScheduleItems(
    attachShoppingHighlight(
      mergeRawTextMealEvidence(
        normalizeStructuredItineraryEntities(finalPrune.itineraryData),
        input.productRawText,
      ),
      extractCatalogShoppingForRender(input.productRawText),
    ),
  );
  const postRangeRepair = pruneOutOfRangePollutedDays(postMergePrune.itineraryData, input.durationDays);
  warnings.push(...postRangeRepair.warnings);
  const duplicateDayRepair = collapseDuplicateDayEntries(postRangeRepair.itineraryData, input.durationDays);
  warnings.push(...duplicateDayRepair.warnings);
  const itineraryDataToSave = preserveTopLevelFlightSegments(duplicateDayRepair.itineraryData, itineraryInput);

  const extractedCandidateRows: Array<{ activity: string; destination?: string }> = [];
  for (const day of itineraryDataToSave?.days ?? []) {
    for (const s of day.schedule ?? []) {
      if (s.type === 'flight' || s.type === 'hotel' || !s.activity) continue;
      if (!shouldAttemptAttractionMatch(s as { activity: string; note?: string | null; type?: string })) continue;
      const candidates = extractAttractionCandidates(s.activity, s.note);
      for (const candidate of candidates) {
        extractedCandidateRows.push({
          activity: candidate,
          ...(input.destination ? { destination: input.destination } : {}),
        });
      }
    }
  }

  return {
    itineraryInput,
    itineraryDataToSave,
    scheduleItemCount,
    matchedScheduleItemCount: enrichment.matchedScheduleItemCount ?? enrichment.matchedCanonicalNames.length,
    unmatchedCandidateCount: enrichment.unmatchedCandidates.length,
    unmatchedCandidates: enrichment.unmatchedCandidates,
    matchedCanonicalNames: enrichment.matchedCanonicalNames,
    extractedCandidateRows,
    fallbackApplied,
    fallbackAirline,
    removedPollutedScheduleItems: [...initialPrune.removed, ...finalPrune.removed, ...postMergePrune.removed],
    warnings,
  };
}
