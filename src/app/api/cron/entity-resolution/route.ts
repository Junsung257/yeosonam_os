import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  resolveItineraryEntityCandidate,
  type EntityCandidateRow,
  type EntityResolutionDecision,
} from '@/lib/itinerary-entity-resolution-engine';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';

function limitFrom(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('limit') || process.env.ENTITY_RESOLUTION_CRON_LIMIT || '20';
  const value = Number(raw);
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function updatePayload(decision: EntityResolutionDecision) {
  return {
    external_sources: decision.externalSources,
    suggested_master: decision.suggestedMaster,
    confidence: decision.verificationScore,
    auto_action: decision.autoAction,
    promotion_status: decision.promotionStatus,
    decision_reason: decision.decisionReason,
    auto_verification_status: decision.autoVerificationStatus,
    verification_score: decision.verificationScore,
    canonical_name: decision.canonicalName,
    canonical_name_source: decision.canonicalNameSource,
    source_reliability_snapshot: {
      source_count: decision.externalSources.length,
      sources: [...new Set(decision.externalSources.map(source => source.source))],
      naver_search_score: decision.naver?.searchScore ?? null,
      naver_keyword_score: decision.naver?.keywordScore ?? null,
      wikidata_top_score: decision.wikidata[0]?.confidence ?? null,
    },
    verified_at: new Date().toISOString(),
  };
}

const handleEntityResolution = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return { ok: true, scanned: 0, updated: 0, errors: [] as string[] };

  const limit = limitFrom(request);
  const category = request.nextUrl.searchParams.get('category');

  let query = supabaseAdmin
    .from('entity_master_candidates')
    .select('id, candidate_key, category, raw_label, normalized_label, destination_scope, country_scope, region_scope, evidence_count, occurrence_count, package_count, source_context, external_sources, suggested_master, confidence, auto_action, promotion_status')
    .in('promotion_status', ['candidate', 'auto_internal', 'needs_review', 'publishable_ready'])
    .order('verified_at', { ascending: true, nullsFirst: true })
    .order('occurrence_count', { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq('category', category);
  } else {
    query = query.in('category', ['attraction', 'hotel', 'shopping', 'optional_tour', 'notice']);
  }

  const { data, error } = await query;
  if (error) {
    const message = sanitizeDbError(error, 'Failed to load entity candidates');
    return { ok: false, error: message, errors: [message] };
  }

  let updated = 0;
  const errors: string[] = [];
  const byStatus: Record<string, number> = {};
  const byAction: Record<string, number> = {};

  for (const row of (data ?? []) as EntityCandidateRow[]) {
    try {
      const decision = await resolveItineraryEntityCandidate(row);
      byStatus[decision.autoVerificationStatus] = (byStatus[decision.autoVerificationStatus] ?? 0) + 1;
      byAction[decision.autoAction] = (byAction[decision.autoAction] ?? 0) + 1;

      const { error: updateError } = await supabaseAdmin
        .from('entity_master_candidates')
        .update(updatePayload(decision))
        .eq('id', row.id);
      if (updateError) throw updateError;

      const attempts = decision.attempts.map(attempt => ({
        candidate_id: row.id,
        candidate_key: decision.candidateKey,
        source: attempt.source,
        query: attempt.query,
        status: attempt.status,
        score: attempt.score,
        evidence: attempt.evidence,
        error: attempt.error ?? null,
      }));
      if (attempts.length > 0) {
        const { error: attemptsError } = await supabaseAdmin
          .from('entity_verification_attempts')
          .insert(attempts);
        if (attemptsError) throw attemptsError;
      }
      updated += 1;
    } catch (err) {
      errors.push(sanitizeDbError(err, `entity resolution failed for ${row.candidate_key}`));
    }
  }

  return {
    ok: true,
    scanned: data?.length ?? 0,
    updated,
    limit,
    category: category || 'all',
    byStatus,
    byAction,
    active_pending_after: await countActiveUnmatched(),
    errors: errors.slice(0, 20),
  };
};

export const GET = withCronLogging('entity-resolution', handleEntityResolution);
