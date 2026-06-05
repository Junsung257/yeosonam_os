import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttractionData } from '@/lib/attraction-matcher';
import { inferCountryFromDestination } from '@/lib/destination-iso';

export type UploadUnmatchedActivityRow = {
  activity: string;
  package_id: string;
  package_title: string;
  day_number: number;
  country: string | null;
};

export type UploadExtractedCandidateRow = {
  activity: string;
  destination?: string;
};

export type QueueUploadAttractionReviewInput = {
  supabaseAdmin: SupabaseClient;
  unmatchedRows: UploadUnmatchedActivityRow[];
  extractedCandidateRows: UploadExtractedCandidateRow[];
  matchedCanonicalNames: Iterable<string>;
  activeAttractions: AttractionData[];
  fallbackPackageId: string | null;
  fallbackPackageTitle: string | null;
};

export type QueueUploadAttractionReviewResult = {
  unmatchedQueued: number;
  newCandidateQueued: number;
  mentionCounted: number;
};

export type FlushUploadAttractionReviewQueueInput = QueueUploadAttractionReviewInput & {
  isSupabaseConfigured: boolean;
  bulkMode: boolean;
};

async function upsertScopedUnmatched(
  supabaseAdmin: SupabaseClient,
  row: UploadUnmatchedActivityRow & { region?: string | null },
): Promise<void> {
  const rpc = await supabaseAdmin.rpc('increment_unmatched_count', {
    p_activity: row.activity,
    p_package_id: row.package_id,
    p_package_title: row.package_title,
    p_day_number: row.day_number,
    p_country: row.country,
  });
  if (!rpc.error) return;

  const { error } = await supabaseAdmin.from('unmatched_activities').upsert({
    activity: row.activity,
    package_id: row.package_id,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    region: row.region ?? null,
    occurrence_count: 1,
    status: 'pending',
  }, { onConflict: 'unmatched_scope_key,activity' });
  if (error) throw new Error(error.message);
}

export async function queueUploadAttractionReviewCandidates(
  input: QueueUploadAttractionReviewInput,
): Promise<QueueUploadAttractionReviewResult> {
  let unmatchedQueued = 0;
  let mentionCounted = 0;
  let newCandidateQueued = 0;

  for (const row of input.unmatchedRows) {
    await upsertScopedUnmatched(input.supabaseAdmin, row);
    unmatchedQueued++;
  }

  for (const name of input.matchedCanonicalNames) {
    await input.supabaseAdmin
      .rpc('increment_mention_count', { attraction_name: name })
      .then(undefined, () => {});
    mentionCounted++;
  }

  if (input.extractedCandidateRows.length === 0) {
    return { unmatchedQueued, newCandidateQueued, mentionCounted };
  }

  const existingNames = new Set(
    input.activeAttractions.map(attraction => attraction.name.toLowerCase().replace(/\s+/g, '')),
  );
  const newActivities = input.extractedCandidateRows.filter(candidate =>
    !existingNames.has(candidate.activity.toLowerCase().replace(/\s+/g, '')),
  );
  if (newActivities.length === 0 || !input.fallbackPackageId) {
    return { unmatchedQueued, newCandidateQueued, mentionCounted };
  }

  const firstDestination = newActivities.find(candidate => candidate.destination)?.destination ?? null;
  const firstCountry = inferCountryFromDestination(firstDestination);
  const uniqueNew = [...new Set(newActivities.map(candidate => candidate.activity))].slice(0, 30);

  for (const activity of uniqueNew) {
    await upsertScopedUnmatched(input.supabaseAdmin, {
      activity,
      package_id: input.fallbackPackageId,
      package_title: input.fallbackPackageTitle ?? '',
      day_number: 0,
      country: firstCountry,
      region: firstDestination,
    });
    newCandidateQueued++;
  }

  return { unmatchedQueued, newCandidateQueued, mentionCounted };
}

export async function flushUploadAttractionReviewQueue(
  input: FlushUploadAttractionReviewQueueInput,
): Promise<QueueUploadAttractionReviewResult | null> {
  if (!input.isSupabaseConfigured || input.bulkMode) return null;

  try {
    const queued = await queueUploadAttractionReviewCandidates(input);
    if (queued.unmatchedQueued + queued.newCandidateQueued + queued.mentionCounted > 0) {
      console.log('[Upload API] attraction review queue:', queued);
    }
    return queued;
  } catch (attrError) {
    console.warn('[Upload API] attraction review queue failed:', attrError instanceof Error ? attrError.message : attrError);
    return null;
  }
}
