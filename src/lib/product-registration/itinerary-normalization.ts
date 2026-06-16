import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';
import type { AttractionData } from '@/lib/attraction-matcher';
import {
  enrichItineraryWithAttractionReferences,
  shouldAttemptAttractionMatch,
  type ItineraryDataLike,
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

function activityKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
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
  itineraryInput = compileItineraryForLanding(initialPrune.itineraryData);

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
  const itineraryDataToSave = postMergePrune.itineraryData;

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
