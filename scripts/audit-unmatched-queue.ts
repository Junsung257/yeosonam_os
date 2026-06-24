import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

type CountableQuery = {
  eq: (column: string, value: unknown) => CountableQuery;
  in: (column: string, values: unknown[]) => CountableQuery;
  is: (column: string, value: unknown) => CountableQuery;
  not: (column: string, operator: string, value: unknown) => CountableQuery;
  gte: (column: string, value: unknown) => CountableQuery;
  then: Promise<{ count: number | null; error: unknown }>['then'];
};

async function countRows(apply: (query: CountableQuery) => CountableQuery): Promise<number> {
  const query = apply(
    supabase
      .from('unmatched_activities')
      .select('*', { count: 'exact', head: true }) as unknown as CountableQuery,
  );
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function countCandidateLinkedRows(scope: 'pending' | 'terminal'): Promise<number> {
  const { data: candidates, error: candidateError } = await supabase
    .from('entity_master_candidates')
    .select('source_unmatched_ids')
    .limit(5000);
  if (candidateError) return 0;

  const ids = [...new Set((candidates ?? [])
    .flatMap(row => Array.isArray(row.source_unmatched_ids) ? row.source_unmatched_ids as string[] : [])
    .filter(Boolean))];
  if (ids.length === 0) return 0;

  let linkedCount = 0;
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('id, status, resolved_at')
      .in('id', chunk);
    if (error) return 0;
    linkedCount += (data ?? []).filter(row => {
    const item = row as { status?: string | null; resolved_at?: string | null };
    if (scope === 'pending') return item.status === 'pending';
    return item.status === 'added' || item.status === 'ignored' || item.resolved_at != null;
  }).length;
  }
  return linkedCount;
}

type ActiveRow = {
  activity: string | null;
  package_title: string | null;
  day_number: number | null;
  country: string | null;
  region: string | null;
  occurrence_count: number | null;
  segment_kind_guess: string | null;
  confidence: number | null;
  suggested_action: string | null;
  created_at: string | null;
};

async function fetchActiveRows(): Promise<ActiveRow[]> {
  const rows: ActiveRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('unmatched_activities')
      .select('activity, package_title, day_number, country, region, occurrence_count, segment_kind_guess, confidence, suggested_action, created_at')
      .eq('status', 'pending')
      .is('resolved_at', null)
      .order('occurrence_count', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as ActiveRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    total,
    activePending,
    pendingResolvedConflict,
    legacyResolved,
    added,
    ignored,
    terminalWithoutResolvedAt,
    recentCreated,
    pendingLinkedCandidate,
    terminalLinkedCandidate,
  ] = await Promise.all([
    countRows(query => query),
    countRows(query => query.eq('status', 'pending').is('resolved_at', null)),
    countRows(query => query.eq('status', 'pending').not('resolved_at', 'is', null)),
    countRows(query => query.eq('status', 'resolved')),
    countRows(query => query.eq('status', 'added')),
    countRows(query => query.eq('status', 'ignored')),
    countRows(query => query.in('status', ['added', 'ignored']).is('resolved_at', null)),
    countRows(query => query.gte('created_at', since)),
    countCandidateLinkedRows('pending'),
    countCandidateLinkedRows('terminal'),
  ]);

  const activeRows = await fetchActiveRows();

  const byCategory: Record<string, number> = {};
  const bySuggestedAction: Record<string, number> = {};
  const byCreatedDay: Record<string, number> = {};
  const queueSplit = {
    attraction_gap: 0,
    candidate_master: 0,
    hotel_nonblocking: 0,
    notice_noise: 0,
    auto_terminal_ready: 0,
    manual_review: 0,
    unclassified: 0,
  };

  for (const row of activeRows) {
    const category = String(row.segment_kind_guess ?? 'null');
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const action = String(row.suggested_action ?? 'null');
    bySuggestedAction[action] = (bySuggestedAction[action] ?? 0) + 1;
    const createdDay = row.created_at ? row.created_at.slice(0, 10) : 'null';
    byCreatedDay[createdDay] = (byCreatedDay[createdDay] ?? 0) + 1;

    if (category === 'attraction') queueSplit.attraction_gap++;
    if (action === 'candidate_queue') queueSplit.candidate_master++;
    if (category === 'hotel') queueSplit.hotel_nonblocking++;
    if (['notice', 'price_noise', 'free_time'].includes(category)) queueSplit.notice_noise++;
    if (['meal', 'transfer', 'price_noise', 'free_time'].includes(category)) queueSplit.auto_terminal_ready++;
    if (['shopping', 'optional_tour', 'unknown'].includes(category)) queueSplit.manual_review++;
    if (category === 'null') queueSplit.unclassified++;
  }

  const top = activeRows.slice(0, 30).map(row => ({
    activity: row.activity,
    package_title: row.package_title,
    day_number: row.day_number,
    country: row.country,
    region: row.region,
    occurrence_count: row.occurrence_count,
    category: row.segment_kind_guess,
    confidence: row.confidence,
    suggested_action: row.suggested_action,
    created_at: row.created_at,
  }));

  const { data: cronRuns, error: cronError } = await supabase
    .from('cron_run_logs')
    .select('cron_name, status, started_at, finished_at, elapsed_ms, error_count, error_messages')
    .in('cron_name', [
      'unmatched-orchestrator',
      'unmatched-classify',
      'resweep-unmatched',
      'unmatched-auto-resolve',
      'entity-master-candidates',
      'entity-resolution',
      'promote-internal-candidates',
    ])
    .order('started_at', { ascending: false })
    .limit(30);
  if (cronError) throw cronError;

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    counts: {
      total,
      active_pending: activePending,
      pending_resolved_conflict: pendingResolvedConflict,
      legacy_resolved_status: legacyResolved,
      terminal_without_resolved_at: terminalWithoutResolvedAt,
      added,
      ignored,
      created_last_7d: recentCreated,
      pending_linked_candidate: pendingLinkedCandidate,
      terminal_linked_candidate: terminalLinkedCandidate,
    },
    active_pending_by_category: byCategory,
    active_pending_by_suggested_action: bySuggestedAction,
    active_pending_by_created_day: byCreatedDay,
    active_pending_queue_split: queueSplit,
    top_active_pending: top,
    recent_unmatched_cron_runs: cronRuns ?? [],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
