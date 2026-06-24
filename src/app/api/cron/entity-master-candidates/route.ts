import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { evaluateMasterCandidate, type CandidateExternalSource } from '@/lib/entity-master-candidates';
import {
  closeUnmatchedAsCandidateQueued,
  closeUnmatchedAsIgnored,
  countActiveUnmatched,
} from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';

type UnmatchedRow = {
  id: string;
  activity: string;
  package_id: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  segment_kind_guess: string | null;
  suggested_resolution: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
};

type CandidateGroup = {
  decision: ReturnType<typeof evaluateMasterCandidate>;
  ids: string[];
  packageIds: Set<string>;
  packageTitles: Set<string>;
  occurrenceCount: number;
  examples: Array<Record<string, unknown>>;
};

function limitFrom(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get('limit') ?? process.env.ENTITY_MASTER_CANDIDATE_LIMIT ?? 500);
  return Number.isFinite(raw) ? Math.max(1, Math.min(2000, Math.floor(raw))) : 500;
}

function externalSourcesFrom(row: UnmatchedRow): CandidateExternalSource[] {
  const fromResolution = row.suggested_resolution?.external_sources;
  const fromContext = row.source_context?.external_sources;
  const sources = Array.isArray(fromResolution) ? fromResolution : Array.isArray(fromContext) ? fromContext : [];
  return sources
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const value = item as Record<string, unknown>;
      return {
        source: String(value.source ?? 'supplier') as CandidateExternalSource['source'],
        id: typeof value.id === 'string' ? value.id : null,
        url: typeof value.url === 'string' ? value.url : null,
        confidence: typeof value.confidence === 'number' ? value.confidence : null,
        name: typeof value.name === 'string' ? value.name : null,
      };
    });
}

function buildGroups(rows: UnmatchedRow[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();

  for (const row of rows) {
    const decision = evaluateMasterCandidate({
      rawLabel: row.activity,
      category: row.segment_kind_guess,
      country: row.country,
      region: row.region,
      destination: row.region ?? row.country,
      occurrenceCount: row.occurrence_count ?? 1,
      evidenceCount: 1,
      packageCount: row.package_id ? 1 : 0,
      externalSources: externalSourcesFrom(row),
    });

    const existing = groups.get(decision.candidateKey);
    if (!existing) {
      groups.set(decision.candidateKey, {
        decision,
        ids: [row.id],
        packageIds: new Set(row.package_id ? [row.package_id] : []),
        packageTitles: new Set(row.package_title ? [row.package_title] : []),
        occurrenceCount: row.occurrence_count ?? 1,
        examples: [{
          id: row.id,
          package_id: row.package_id,
          package_title: row.package_title,
          day_number: row.day_number,
          country: row.country,
          region: row.region,
          activity: row.activity,
        }],
      });
      continue;
    }

    existing.ids.push(row.id);
    existing.occurrenceCount += row.occurrence_count ?? 1;
    if (row.package_id) existing.packageIds.add(row.package_id);
    if (row.package_title) existing.packageTitles.add(row.package_title);
    if (existing.examples.length < 5) {
      existing.examples.push({
        id: row.id,
        package_id: row.package_id,
        package_title: row.package_title,
        day_number: row.day_number,
        country: row.country,
        region: row.region,
        activity: row.activity,
      });
    }
  }

  return [...groups.values()];
}

function payloadFor(group: CandidateGroup) {
  const decision = group.decision;
  return {
    candidate_key: decision.candidateKey,
    category: decision.category,
    raw_label: decision.rawLabel,
    normalized_label: decision.normalizedLabel,
    destination_scope: decision.destinationScope,
    country_scope: decision.countryScope,
    region_scope: decision.regionScope,
    evidence_count: group.ids.length,
    occurrence_count: group.occurrenceCount,
    package_count: group.packageIds.size,
    source_unmatched_ids: group.ids,
    source_context: {
      package_ids: [...group.packageIds].slice(0, 50),
      package_titles: [...group.packageTitles].slice(0, 20),
      examples: group.examples,
      analyzer: 'entity-master-candidates-cron',
      analyzed_at: new Date().toISOString(),
    },
    external_sources: [],
    suggested_master: decision.suggestedMaster,
    confidence: decision.confidence,
    promotion_status: decision.promotionStatus,
    auto_action: decision.autoAction,
    decision_reason: decision.decisionReason,
  };
}

async function runEntityMasterCandidates(options: { limit?: number } = {}) {
  if (!isSupabaseConfigured) {
    return { ok: true, scanned: 0, groups: 0, upserted: 0, closed: 0, ignored: 0, errors: [] as string[] };
  }

  try {
    const limit = options.limit ?? 500;
    const { data, error } = await supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, package_id, package_title, day_number, country, region, occurrence_count, segment_kind_guess, suggested_resolution, source_context')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .eq('segment_kind_guess', 'attraction')
      .order('occurrence_count', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as UnmatchedRow[];
    const groups = buildGroups(rows);
    let upsertedRows: Array<{
      id: string;
      candidate_key: string;
      category: string;
      promotion_status: string;
      canonical_name: string | null;
      normalized_label: string | null;
    }> = [];
    if (groups.length > 0) {
      const { data: upserted, error: upsertError } = await supabaseAdmin
        .from('entity_master_candidates')
        .upsert(groups.map(payloadFor), { onConflict: 'candidate_key' })
        .select('id, candidate_key, category, promotion_status, canonical_name, normalized_label');
      if (upsertError) throw upsertError;
      upsertedRows = (upserted ?? []) as typeof upsertedRows;
    }

    const groupByKey = new Map(groups.map(group => [group.decision.candidateKey, group]));
    let closed = 0;
    let ignored = 0;
    const closeErrors: string[] = [];

    for (const candidate of upsertedRows) {
      const group = groupByKey.get(candidate.candidate_key);
      if (!group) continue;
      try {
        if (candidate.promotion_status === 'rejected_noise') {
          ignored += await closeUnmatchedAsIgnored(group.ids, {
            resolvedKind: 'candidate_rejected_noise',
            resolvedBy: 'cron_entity_master_candidates',
            suggestedAction: 'ignore_noise',
            segmentKindGuess: candidate.category,
            suggestedResolution: {
              strategy: 'entity_master_candidate_rejected_noise',
              candidate_id: candidate.id,
              candidate_key: candidate.candidate_key,
              candidate_category: candidate.category,
              candidate_label: candidate.canonical_name ?? candidate.normalized_label,
            },
          });
        } else {
          closed += await closeUnmatchedAsCandidateQueued(group.ids, {
            candidateId: candidate.id,
            candidateKey: candidate.candidate_key,
            candidateStatus: candidate.promotion_status,
            candidateCategory: candidate.category,
            candidateLabel: candidate.canonical_name ?? candidate.normalized_label,
            resolvedBy: 'cron_entity_master_candidates',
          });
        }
      } catch (error) {
        closeErrors.push(sanitizeDbError(error, `failed to close source unmatched for ${candidate.candidate_key}`));
      }
    }

    return {
      ok: closeErrors.length === 0,
      scanned: rows.length,
      groups: groups.length,
      upserted: upsertedRows.length,
      closed,
      ignored,
      active_pending_after: await countActiveUnmatched(),
      errors: closeErrors.slice(0, 20),
    };
  } catch (error) {
    const message = sanitizeDbError(error, 'entity master candidate generation failed');
    return { ok: false, error: message, errors: [message] };
  }
}

const handleEntityMasterCandidates = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return runEntityMasterCandidates({ limit: limitFrom(request) });
};

export const GET = withCronLogging('entity-master-candidates', handleEntityMasterCandidates);
