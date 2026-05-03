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

async function countUnmatched(filter: (q: ReturnType<typeof supabaseAdmin.from>) => ReturnType<typeof supabaseAdmin.from>): Promise<number> {
  let q = supabaseAdmin.from('unmatched_activities').select('*', { count: 'exact', head: true });
  q = filter(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getUnmatchedSummary(): Promise<UnmatchedSummary> {
  const { minOccurrences: highOccMin } = getUnmatchedBootstrapEnvDefaults();
  const [pending, ignored, added, all, pending_high_occurrence, auto_alias_resolved_total, manual_link_alias_total, recentRes] = await Promise.all([
    countUnmatched(q => q.eq('status', 'pending')),
    countUnmatched(q => q.eq('status', 'ignored')),
    countUnmatched(q => q.eq('status', 'added')),
    countUnmatched(q => q),
    countUnmatched(q => q.eq('status', 'pending').gte('occurrence_count', highOccMin)),
    countUnmatched(q => q.eq('resolved_kind', 'auto_cron_high_confidence')),
    countUnmatched(q => q.eq('resolved_kind', 'manual_link_alias')),
    supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, resolved_at, resolved_attraction_id, occurrence_count')
      .eq('resolved_kind', 'auto_cron_high_confidence')
      .order('resolved_at', { ascending: false })
      .limit(8),
  ]);

  if (recentRes.error) throw recentRes.error;

  return {
    counts: { pending, ignored, added, all },
    pending_high_occurrence,
    auto_alias_resolved_total,
    manual_link_alias_total,
    high_occurrence_threshold: highOccMin,
    recent_auto_alias: (recentRes.data || []) as UnmatchedSummary['recent_auto_alias'],
  };
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
