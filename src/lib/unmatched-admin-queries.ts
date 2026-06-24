import { supabaseAdmin } from '@/lib/supabase';
import { getUnmatchedBootstrapEnvDefaults } from '@/lib/unmatched-bootstrap-config';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';

export interface UnmatchedSummary {
  counts: {
    pending: number;
    ignored: number;
    added: number;
    all: number;
  };
  pending_high_occurrence: number;
  auto_alias_resolved_total: number;
  /** PATCH link_alias (어드민 1클릭) — resolved_kind = manual_link_alias */
  manual_link_alias_total: number;
  pending_resolved_conflict_count: number;
  legacy_resolved_status_count: number;
  active_pending_count: number;
  terminal_reingest_blocked_recent: number;
  candidate_queued_total: number;
  auto_ignored_total: number;
  cron_last_success_at: string | null;
  queue_split: {
    attraction_gap: number;
    candidate_master: number;
    hotel_nonblocking: number;
    notice_noise: number;
    auto_terminal_ready: number;
    manual_review: number;
    unclassified: number;
  };
  /** `pending_high_occurrence` 집계에 쓰인 등장 횟수 하한 (env와 부트스트랩 기본과 동일) */
  high_occurrence_threshold: number;
  recent_auto_alias: Array<{
    id: string;
    activity: string;
    resolved_at: string | null;
    resolved_attraction_id: string | null;
    occurrence_count: number | null;
  }>;
}

/**
 * 어드민 사이드바 미매칭 배지 — 단일 RPC 로 7개 count → 1 round-trip.
 * 마이그레이션: 20260518000000_admin_perf_summary_rpcs.sql
 * 감사: docs/audits/2026-05-11-admin-perf-audit.md (모든 어드민 페이지에서 31s → ~50ms)
 */
export async function getUnmatchedSummary(): Promise<UnmatchedSummary> {
  const { minOccurrences: highOccMin } = getUnmatchedBootstrapEnvDefaults();
  const [
    { data, error },
    activePending,
    pendingResolvedConflict,
    legacyResolved,
    terminalRecent,
    candidateQueued,
    autoIgnored,
    cronLastSuccess,
    queueSplit,
  ] = await Promise.all([
    supabaseAdmin.rpc('get_unmatched_summary', { p_high_occ_min: highOccMin }),
    countRows(query => query.eq('status', 'pending').is('resolved_at', null)),
    countRows(query => query.eq('status', 'pending').not('resolved_at', 'is', null)),
    countRows(query => query.eq('status', 'resolved')),
    countTerminalReingests(),
    countRows(query => query.eq('suggested_action', 'candidate_queue')),
    countRows(query => query.eq('status', 'ignored')),
    getLastUnmatchedCronSuccessAt(),
    getQueueSplit(),
  ]);
  if (error) throw error;
  return {
    ...(data as UnmatchedSummary),
    active_pending_count: activePending,
    pending_resolved_conflict_count: pendingResolvedConflict,
    legacy_resolved_status_count: legacyResolved,
    terminal_reingest_blocked_recent: terminalRecent,
    candidate_queued_total: candidateQueued,
    auto_ignored_total: autoIgnored,
    cron_last_success_at: cronLastSuccess,
    queue_split: queueSplit,
  };
}

type CountableQuery = {
  eq: (column: string, value: unknown) => CountableQuery;
  is: (column: string, value: unknown) => CountableQuery;
  in: (column: string, values: unknown[]) => CountableQuery;
  not: (column: string, operator: string, value: unknown) => CountableQuery;
  then: Promise<{ count: number | null; error: unknown }>['then'];
};

async function countRows(apply: (query: CountableQuery) => CountableQuery): Promise<number> {
  const query = apply(
    supabaseAdmin
      .from('unmatched_activities')
      .select('*', { count: 'exact', head: true }) as unknown as CountableQuery,
  );
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

function activePending(query: CountableQuery): CountableQuery {
  return query.eq('status', 'pending').is('resolved_at', null);
}

async function getQueueSplit(): Promise<UnmatchedSummary['queue_split']> {
  const [
    attractionGap,
    candidateMaster,
    hotelNonblocking,
    noticeNoise,
    autoTerminalReady,
    manualReview,
    unclassified,
  ] = await Promise.all([
    countRows(query => activePending(query).eq('segment_kind_guess', 'attraction')),
    countRows(query => activePending(query).eq('suggested_action', 'candidate_queue')),
    countRows(query => activePending(query).eq('segment_kind_guess', 'hotel')),
    countRows(query => activePending(query).in('segment_kind_guess', ['notice', 'price_noise', 'free_time'])),
    countRows(query => activePending(query).in('segment_kind_guess', ['meal', 'transfer', 'price_noise', 'free_time'])),
    countRows(query => activePending(query).in('segment_kind_guess', ['shopping', 'optional_tour', 'unknown'])),
    countRows(query => activePending(query).is('segment_kind_guess', null)),
  ]);

  return {
    attraction_gap: attractionGap,
    candidate_master: candidateMaster,
    hotel_nonblocking: hotelNonblocking,
    notice_noise: noticeNoise,
    auto_terminal_ready: autoTerminalReady,
    manual_review: manualReview,
    unclassified,
  };
}

async function countTerminalReingests(): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('unmatched_activities')
    .select('updated_at, resolved_at')
    .in('status', ['added', 'ignored', 'resolved'])
    .not('resolved_at', 'is', null)
    .gte('updated_at', since)
    .limit(5000);
  if (error) throw error;
  return (data ?? []).filter(row => {
    const updatedAt = Date.parse(String((row as { updated_at?: string | null }).updated_at ?? ''));
    const resolvedAt = Date.parse(String((row as { resolved_at?: string | null }).resolved_at ?? ''));
    return Number.isFinite(updatedAt) && Number.isFinite(resolvedAt) && updatedAt > resolvedAt;
  }).length;
}

async function getLastUnmatchedCronSuccessAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('finished_at')
    .in('cron_name', [
      'unmatched-orchestrator',
      'unmatched-classify',
      'resweep-unmatched',
      'unmatched-auto-resolve',
      'entity-master-candidates',
      'entity-resolution',
      'promote-internal-candidates',
    ])
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return (data?.[0] as { finished_at?: string | null } | undefined)?.finished_at ?? null;
}

export interface BootstrapCandidateRow {
  id: string;
  activity: string;
  occurrence_count: number | null;
  region: string | null;
  country: string | null;
  suggestion: {
    id: string;
    name: string;
    score: number;
    matched_via: string;
    matched_term: string;
  } | null;
}

/**
 * 등장 빈도가 높은데 자동 cron(기본 95점+)에 걸리지 않는 애매한 케이스 → 수동 1클릭용 후보.
 */
export async function getUnmatchedBootstrapCandidates(options: {
  minOccurrences: number;
  scoreMin: number;
  scoreMax: number;
  maxRows: number;
}): Promise<BootstrapCandidateRow[]> {
  const { minOccurrences, scoreMin, scoreMax, maxRows } = options;

  const [{ data: pendingRows }, { data: attractions }] = await Promise.all([
    supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, region, country, occurrence_count')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .gte('occurrence_count', minOccurrences)
      .order('occurrence_count', { ascending: false })
      .limit(120),
    supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .limit(5000),
  ]);

  const candidateRows = (attractions || []) as AttractionSuggestRow[];
  const out: BootstrapCandidateRow[] = [];

  for (const row of pendingRows || []) {
    const u = row as BootstrapCandidateRow;
    const scoped = candidateRows.filter(
      a =>
        (!u.region || !a.region || a.region === u.region) && (!u.country || !a.country || a.country === u.country),
    );
    const pool = scoped.length > 0 ? scoped : candidateRows;
    const { suggestions } = suggestAttractionsForActivity(u.activity, pool, scoreMin, 1);
    if (suggestions.length === 0) continue;
    const top = suggestions[0];
    if (top.score > scoreMax) continue;
    out.push({
      ...u,
      suggestion: {
        id: top.id,
        name: top.name,
        score: top.score,
        matched_via: top.matched_via,
        matched_term: top.matched_term,
      },
    });
    if (out.length >= maxRows) break;
  }

  return out;
}
