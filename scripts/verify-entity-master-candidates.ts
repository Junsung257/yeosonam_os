import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  resolveItineraryEntityCandidate,
  type EntityCandidateRow,
  type EntityResolutionDecision,
} from '../src/lib/itinerary-entity-resolution-engine';
import { evaluateMasterCandidate } from '../src/lib/entity-master-candidates';
import {
  chooseCanonicalNameFromNaver,
  type NaverEntityVerificationResult,
  type NaverKeywordEvidenceItem,
  type NaverSearchEvidenceItem,
} from '../src/lib/naver-entity-verifier';
import {
  getGooglePlacesBudgetFromEnv,
  type GooglePlacesBudget,
} from '../src/lib/google-places-entity-verifier';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const summaryOnly = args.includes('--summary-only');
const preferCachedNaver = args.includes('--prefer-cached-naver') || args.includes('--naver-cache-only');
const naverCacheOnly = args.includes('--naver-cache-only');
const skipWikidata = args.includes('--skip-wikidata') || naverCacheOnly;
const limit = Number(argValue('--limit', '20'));
const offset = Number(argValue('--offset', '0'));
const categoryFilter = argValue('--category', '');
const destinationFilter = argValue('--destination', '');
const promotionStatusFilter = argList('--promotion-status');
const packageIdFilter = argList('--package-ids');

function argValue(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function argList(name: string): string[] {
  return argValue(name, '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compactText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^가-힣a-z0-9]/g, '');
}

function rowFallbackLabel(row: EntityCandidateRow): string {
  const decision = evaluateMasterCandidate({
    rawLabel: row.raw_label || row.normalized_label || '',
    category: row.category,
    country: row.country_scope,
    region: row.region_scope,
    destination: row.destination_scope,
    occurrenceCount: row.occurrence_count,
    evidenceCount: row.evidence_count,
    packageCount: row.package_count,
  });
  return decision.normalizedLabel || row.normalized_label || row.raw_label || '';
}

function sourceCompacts(row: EntityCandidateRow): string[] {
  return [row.raw_label, row.normalized_label, rowFallbackLabel(row)]
    .map(compactText)
    .filter(value => value.length >= 2);
}

function scopeCompacts(row: EntityCandidateRow): Set<string> {
  return new Set(
    [row.country_scope, row.region_scope, row.destination_scope]
      .map(compactText)
      .filter(value => value.length >= 2),
  );
}

function agreesWithSourceText(row: EntityCandidateRow, value: string): boolean {
  const candidate = compactText(value);
  if (candidate.length < 2) return false;
  const scopes = scopeCompacts(row);
  if (scopes.has(candidate) && sourceCompacts(row).some(source => source !== candidate && source.includes(candidate))) {
    return false;
  }
  return sourceCompacts(row).some(source => (
    source === candidate ||
    source.includes(candidate) ||
    candidate.includes(source)
  ));
}

function cachedSearchAttemptAgrees(row: EntityCandidateRow, query: string, evidence: Record<string, unknown>): boolean {
  if (agreesWithSourceText(row, query)) return true;
  const titles = Array.isArray(evidence.topTitles)
    ? evidence.topTitles.filter((value): value is string => typeof value === 'string')
    : [];
  return titles.some(title => agreesWithSourceText(row, title));
}

async function fetchCandidates(): Promise<EntityCandidateRow[]> {
  const queryLimit = packageIdFilter.length > 0 ? Math.max(limit, 5000) : limit;
  let query = supabase
    .from('entity_master_candidates')
    .select('id, candidate_key, category, raw_label, normalized_label, destination_scope, country_scope, region_scope, evidence_count, occurrence_count, package_count, source_context, external_sources, suggested_master, confidence, auto_action, promotion_status')
    .in('promotion_status', promotionStatusFilter.length > 0
      ? promotionStatusFilter
      : ['candidate', 'auto_internal', 'needs_review', 'publishable_ready'])
    .order('occurrence_count', { ascending: false })
    .range(offset, offset + queryLimit - 1);

  if (categoryFilter) {
    query = query.eq('category', categoryFilter);
  } else {
    query = query.in('category', ['attraction', 'hotel', 'shopping', 'optional_tour', 'notice']);
  }

  if (destinationFilter) {
    query = query.or(`destination_scope.eq.${destinationFilter},region_scope.eq.${destinationFilter},country_scope.eq.${destinationFilter}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as EntityCandidateRow[];
  if (packageIdFilter.length === 0) return rows;
  const wanted = new Set(packageIdFilter);
  return rows
    .filter(row => {
      const ids = row.source_context?.package_ids;
      return Array.isArray(ids) && ids.some(value => typeof value === 'string' && wanted.has(value));
    })
    .slice(0, limit);
}

function emptyCachedNaverResult(row: EntityCandidateRow): NaverEntityVerificationResult {
  return {
    configured: true,
    canonicalName: rowFallbackLabel(row),
    canonicalNameSource: 'input',
    searchScore: 0,
    keywordScore: 0,
    overallScore: 0,
    searchEvidence: [],
    keywordEvidence: [],
    sources: [],
    attempts: [],
  };
}

function evidenceTarget(value: unknown): NaverSearchEvidenceItem['target'] | null {
  return value === 'blog' || value === 'webkr' || value === 'encyc' || value === 'local' ? value : null;
}

async function fetchCachedNaverResult(row: EntityCandidateRow): Promise<NaverEntityVerificationResult | null> {
  const { data, error } = await supabase
    .from('entity_verification_attempts')
    .select('source, query, status, score, evidence, created_at')
    .eq('candidate_key', row.candidate_key)
    .in('source', ['naver_search', 'naver_searchad'])
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw error;

  const searchByQuery = new Map<string, NaverSearchEvidenceItem>();
  const keywordByName = new Map<string, NaverKeywordEvidenceItem>();
  let searchScore = 0;
  let keywordScore = 0;

  for (const attempt of data ?? []) {
    const evidence = (attempt.evidence ?? {}) as Record<string, unknown>;
    if (attempt.source === 'naver_search') {
      const target = evidenceTarget(evidence.target);
      const query = typeof evidence.query === 'string'
        ? evidence.query
        : typeof attempt.query === 'string'
          ? attempt.query.replace(/^(?:blog|webkr|encyc|local):/, '')
          : '';
      if (!target || !query) continue;
      if (!cachedSearchAttemptAgrees(row, query, evidence)) continue;
      const key = `${target}:${query}`;
      if (!searchByQuery.has(key)) {
        searchByQuery.set(key, {
          target,
          query,
          total: Number(evidence.total ?? 0),
          itemCount: Number(evidence.itemCount ?? 0),
          matchedItems: Number(evidence.matchedItems ?? 0),
          exactTitleMatches: Number(evidence.exactTitleMatches ?? 0),
          regionMatches: Number(evidence.regionMatches ?? 0),
          addressMatches: Number(evidence.addressMatches ?? 0),
          topTitles: Array.isArray(evidence.topTitles) ? evidence.topTitles.filter((value): value is string => typeof value === 'string') : [],
          topLinks: Array.isArray(evidence.topLinks) ? evidence.topLinks.filter((value): value is string => typeof value === 'string') : [],
        });
      }
      searchScore = Math.max(searchScore, Number(attempt.score ?? 0));
    }

    if (attempt.source === 'naver_searchad' && Array.isArray(evidence.top)) {
      for (const item of evidence.top) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const keyword = typeof record.keyword === 'string' ? record.keyword : '';
        if (!keyword || keywordByName.has(keyword)) continue;
        if (!agreesWithSourceText(row, keyword)) continue;
        keywordByName.set(keyword, {
          keyword,
          monthlyPc: Number(record.monthlyPc ?? 0),
          monthlyMobile: Number(record.monthlyMobile ?? 0),
          monthlyTotal: Number(record.monthlyTotal ?? 0),
          competition: typeof record.competition === 'number' ? record.competition : null,
        });
      }
      keywordScore = Math.max(keywordScore, Number(attempt.score ?? 0));
    }
  }

  const searchEvidence = [...searchByQuery.values()];
  const keywordEvidence = [...keywordByName.values()].sort((a, b) => b.monthlyTotal - a.monthlyTotal);
  if (searchEvidence.length === 0 && keywordEvidence.length === 0) return null;

  const fallback = rowFallbackLabel(row);
  const canonical = chooseCanonicalNameFromNaver({
    fallback,
    aliases: [row.raw_label || '', row.normalized_label || '', fallback].filter(Boolean),
    keywordEvidence,
    searchEvidence,
  });
  const sources: NaverEntityVerificationResult['sources'] = [];
  if (searchScore >= 0.25) {
    sources.push({
      source: 'naver_search',
      id: canonical.name,
      url: `https://search.naver.com/search.naver?query=${encodeURIComponent(canonical.name)}`,
      confidence: searchScore,
      name: canonical.name,
    });
  }
  if (keywordEvidence.length > 0) {
    sources.push({
      source: 'naver_searchad',
      id: keywordEvidence[0].keyword,
      confidence: keywordScore,
      name: keywordEvidence[0].keyword,
    });
  }

  return {
    configured: true,
    canonicalName: canonical.name,
    canonicalNameSource: canonical.source,
    searchScore,
    keywordScore,
    overallScore: clamp(searchScore * 0.65 + keywordScore * 0.35),
    searchEvidence,
    keywordEvidence,
    sources,
    attempts: [],
  };
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
      osm_nominatim_score: decision.osmNominatim?.score ?? null,
      osm_nominatim_region_conflict: decision.osmNominatim?.regionConflict ?? null,
      google_places_score: decision.googlePlaces?.score ?? null,
      google_places_region_conflict: decision.googlePlaces?.regionConflict ?? null,
      wikidata_top_score: decision.wikidata[0]?.confidence ?? null,
    },
    verified_at: new Date().toISOString(),
  };
}

function startOfUtcDay(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

async function countGooglePlacesAttemptsToday(): Promise<number> {
  const { count, error } = await supabase
    .from('entity_verification_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'google_places')
    .in('status', ['success', 'empty', 'error'])
    .gte('created_at', startOfUtcDay());
  if (error) throw error;
  return count ?? 0;
}

function consumeGooglePlacesBudget(budget: GooglePlacesBudget, decision: EntityResolutionDecision): GooglePlacesBudget {
  const used = decision.attempts.filter(attempt => attempt.source === 'google_places' && attempt.status !== 'skipped').length;
  const remainingDailyCalls = Math.max(0, budget.remainingDailyCalls - used);
  return {
    ...budget,
    remainingDailyCalls,
    skipReason: remainingDailyCalls <= 0 ? 'GOOGLE_PLACES_DAILY_LIMIT exhausted' : budget.skipReason,
  };
}

async function persistDecision(row: EntityCandidateRow, decision: EntityResolutionDecision): Promise<void> {
  const { error: updateError } = await supabase
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
    const { error: insertError } = await supabase
      .from('entity_verification_attempts')
      .insert(attempts);
    if (insertError) throw insertError;
  }
}

function summarize(decisions: EntityResolutionDecision[]) {
  const byStatus: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const decision of decisions) {
    byStatus[decision.autoVerificationStatus] = (byStatus[decision.autoVerificationStatus] ?? 0) + 1;
    byAction[decision.autoAction] = (byAction[decision.autoAction] ?? 0) + 1;
  }
  const top = decisions
    .slice()
    .sort((a, b) => b.verificationScore - a.verificationScore)
    .slice(0, 20)
    .map(decision => ({
      candidate_key: decision.candidateKey,
      canonical_name: decision.canonicalName,
      score: decision.verificationScore,
      status: decision.autoVerificationStatus,
      action: decision.autoAction,
      promotion_status: decision.promotionStatus,
      sources: [...new Set(decision.externalSources.map(source => source.source))],
      reason: decision.decisionReason,
    }));
  return { byStatus, byAction, top };
}

async function main() {
  const rows = await fetchCandidates();
  const decisions: EntityResolutionDecision[] = [];
  const errors: Array<{ candidate_key: string; error: string }> = [];
  let googlePlacesBudget = getGooglePlacesBudgetFromEnv(await countGooglePlacesAttemptsToday());

  for (const row of rows) {
    try {
      const cachedNaver = preferCachedNaver ? await fetchCachedNaverResult(row) : null;
      const decision = await resolveItineraryEntityCandidate(row, {
        googlePlacesBudget,
        ...(cachedNaver || naverCacheOnly
          ? { naverVerifier: async () => cachedNaver ?? emptyCachedNaverResult(row) }
          : {}),
        ...(skipWikidata ? { wikidataReconciler: async () => [] } : {}),
      });
      googlePlacesBudget = consumeGooglePlacesBudget(googlePlacesBudget, decision);
      decisions.push(decision);
      if (apply) await persistDecision(row, decision);
    } catch (error) {
      errors.push({
        candidate_key: row.candidate_key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const output = {
    scanned: rows.length,
    resolved: decisions.length,
    apply,
    offset,
    category: categoryFilter || 'all',
    destination: destinationFilter || null,
    promotion_status: promotionStatusFilter.length > 0 ? promotionStatusFilter : 'default_active',
    naver_cache: naverCacheOnly ? 'only' : preferCachedNaver ? 'prefer' : 'off',
    wikidata: skipWikidata ? 'skipped' : 'on',
    google_places_budget: {
      enabled: googlePlacesBudget.enabled,
      daily_limit: googlePlacesBudget.dailyLimit,
      remaining_daily_calls: googlePlacesBudget.remainingDailyCalls,
      max_queries_per_candidate: googlePlacesBudget.maxQueriesPerCandidate,
      skip_reason: googlePlacesBudget.skipReason ?? null,
    },
    errors,
    ...summarize(decisions),
  };
  const compactOutput = {
    scanned: output.scanned,
    resolved: output.resolved,
    apply: output.apply,
    offset: output.offset,
    category: output.category,
    destination: output.destination,
    promotion_status: output.promotion_status,
    naver_cache: output.naver_cache,
    wikidata: output.wikidata,
    google_places_budget: output.google_places_budget,
    errors: output.errors,
    byStatus: output.byStatus,
    byAction: output.byAction,
  };

  if (json) {
    console.log(JSON.stringify(summaryOnly ? compactOutput : output, null, 2));
  } else {
    console.log(summaryOnly ? compactOutput : output);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
