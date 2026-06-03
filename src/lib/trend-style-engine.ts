import { supabaseAdmin } from '@/lib/supabase';

export interface TrendStyleFingerprint {
  platform: 'threads' | 'instagram';
  destination: string;
  audience: string;
  hook_type: string;
  style_key: string;
  source_type: 'external_trend' | 'owned_performance' | 'mixed';
  sample_count: number;
  avg_score: number | null;
  avg_er: number | null;
  avg_hook_words: number | null;
  avg_posting_hour: number | null;
  avg_emoji_count: number | null;
  avg_hashtag_count: number | null;
  sample_first_lines: string[];
  source_breakdown: Record<string, unknown>;
  latest_captured_at: string | null;
}

export interface TrendStyleContextInput {
  platform?: 'threads' | 'instagram';
  destination?: string | null;
  audience?: string | null;
  limit?: number;
}

export interface TrendStyleContext {
  promptBlock: string | null;
  sources: Array<{
    source_type: string;
    destination: string;
    hook_type: string;
    style_key: string;
    sample_count: number;
    avg_score: number | null;
    avg_er: number | null;
    latest_captured_at: string | null;
  }>;
}

type TrendSourceRow = {
  platform: 'threads' | 'instagram';
  destination: string;
  audience: string;
  hook_type: string;
  style_key: string;
  source_type: 'external_trend' | 'owned_performance';
  sample_count: number;
  avg_score: number | null;
  avg_er: number | null;
  avg_hook_words: number | null;
  avg_posting_hour: number | null;
  avg_emoji_count: number | null;
  avg_hashtag_count: number | null;
  sample_first_lines: string[];
  source_breakdown: Record<string, unknown>;
  latest_captured_at: string | null;
};

export async function refreshTrendStyleFingerprints(platform: 'threads' | 'instagram' = 'threads') {
  const externalRows = await buildExternalTrendFingerprints(platform);
  const ownedRows = platform === 'threads' ? await buildOwnedThreadsFingerprints() : [];
  const rows = [...externalRows, ...ownedRows];

  if (rows.length === 0) {
    return { refreshed: 0, external: externalRows.length, owned: ownedRows.length };
  }

  const { error } = await supabaseAdmin
    .from('trend_style_fingerprints')
    .upsert(rows, {
      onConflict: 'platform,destination,audience,hook_type,style_key,source_type',
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`trend_style_fingerprints upsert failed: ${error.message}`);
  }

  return { refreshed: rows.length, external: externalRows.length, owned: ownedRows.length };
}

export async function getTrendStyleContext(input: TrendStyleContextInput = {}): Promise<TrendStyleContext> {
  const platform = input.platform ?? 'threads';
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const destination = normalizeDimension(input.destination);
  const audience = normalizeDimension(input.audience);

  const rows = await fetchFingerprints({ platform, destination, audience, limit });
  if (rows.length > 0) {
    return buildContextFromFingerprints(rows);
  }

  const fallbackRows = await fetchTrendingHooksFallback(platform, limit);
  if (fallbackRows.length === 0 && platform === 'threads') return buildCuratedThreadsFallback();
  if (fallbackRows.length === 0) return { promptBlock: null, sources: [] };
  return buildContextFromFingerprints(fallbackRows);
}

async function fetchFingerprints(args: {
  platform: 'threads' | 'instagram';
  destination: string;
  audience: string;
  limit: number;
}): Promise<TrendStyleFingerprint[]> {
  try {
    const destinationCandidates = Array.from(new Set([args.destination, 'global']));
    const audienceCandidates = Array.from(new Set([args.audience, 'global']));
    const { data, error } = await supabaseAdmin
      .from('trend_style_fingerprints')
      .select('platform, destination, audience, hook_type, style_key, source_type, sample_count, avg_score, avg_er, avg_hook_words, avg_posting_hour, avg_emoji_count, avg_hashtag_count, sample_first_lines, source_breakdown, latest_captured_at')
      .eq('platform', args.platform)
      .in('destination', destinationCandidates)
      .in('audience', audienceCandidates)
      .order('avg_score', { ascending: false, nullsFirst: false })
      .order('sample_count', { ascending: false })
      .limit(args.limit);

    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map(normalizeFingerprint);
  } catch {
    return [];
  }
}

async function fetchTrendingHooksFallback(
  platform: 'threads' | 'instagram',
  limit: number,
): Promise<TrendStyleFingerprint[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('trending_hooks_7d')
      .select('platform, destination, hook_type, sample_count, avg_score, avg_er, avg_hook_words, sample_first_lines, latest_captured_at')
      .eq('platform', platform)
      .order('avg_score', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => normalizeFingerprint({
      platform: row.platform,
      destination: row.destination,
      audience: 'global',
      hook_type: row.hook_type,
      style_key: 'general',
      source_type: 'external_trend',
      sample_count: row.sample_count,
      avg_score: row.avg_score,
      avg_er: row.avg_er,
      avg_hook_words: row.avg_hook_words,
      avg_posting_hour: null,
      avg_emoji_count: null,
      avg_hashtag_count: null,
      sample_first_lines: row.sample_first_lines,
      source_breakdown: { fallback: 'trending_hooks_7d' },
      latest_captured_at: row.latest_captured_at,
    }));
  } catch {
    return [];
  }
}

function buildContextFromFingerprints(rows: TrendStyleFingerprint[]): TrendStyleContext {
  const lines = rows.map((row, index) => {
    const firstLines = row.sample_first_lines
      .slice(0, 2)
      .map((line) => `  - "${line.slice(0, 120)}"`)
      .join('\n');
    const er = row.avg_er == null ? 'n/a' : `${(row.avg_er * 100).toFixed(2)}%`;
    const score = row.avg_score == null ? 'n/a' : row.avg_score.toFixed(3);
    const hour = row.avg_posting_hour == null ? 'n/a' : `${Math.round(row.avg_posting_hour)} KST`;
    return `${index + 1}. ${row.source_type}/${row.destination}/${row.hook_type}/${row.style_key}: score=${score}, ER=${er}, samples=${row.sample_count}, best_hour=${hour}\n${firstLines}`;
  });

  return {
    promptBlock: `## Learned Threads trend/style signals\nUse these as direction, not as text to copy. Prefer hooks that match destination, audience, and owned performance.\n\n${lines.join('\n\n')}`,
    sources: rows.map((row) => ({
      source_type: row.source_type,
      destination: row.destination,
      hook_type: row.hook_type,
      style_key: row.style_key,
      sample_count: row.sample_count,
      avg_score: row.avg_score,
      avg_er: row.avg_er,
      latest_captured_at: row.latest_captured_at,
    })),
  };
}

function buildCuratedThreadsFallback(): TrendStyleContext {
  return {
    promptBlock: `## Curated Threads fallback patterns
No owned or external trend rows are available yet. Use safe travel operator patterns:

1. question/short_hook: ask a concrete trip-planning question in the first line.
2. personal_story/casual_story: share one operator observation before product details.
3. info_list/general: use a 3-point checklist for price, route, and inclusion checks.

Do not claim real trend performance. Keep the copy useful, specific, and low-risk.`,
    sources: [{
      source_type: 'fallback_curated',
      destination: 'global',
      hook_type: 'question',
      style_key: 'short_hook',
      sample_count: 0,
      avg_score: null,
      avg_er: null,
      latest_captured_at: null,
    }],
  };
}

async function buildExternalTrendFingerprints(platform: 'threads' | 'instagram'): Promise<TrendSourceRow[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('external_trend_posts')
    .select('platform, related_destination, hook_type, performance_score, engagement_rate, hook_words, hashtag_count, emoji_count, hook_first_line, keyword, captured_at')
    .eq('platform', platform)
    .gte('captured_at', since)
    .not('hook_type', 'is', null)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(500);

  if (error || !data) return [];
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of data as Array<Record<string, unknown>>) {
    const destination = normalizeDimension(row.related_destination);
    const hookType = normalizeDimension(row.hook_type, 'unknown');
    const key = `${destination}::${hookType}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .filter(([, rows]) => rows.length >= 2)
    .map(([key, rows]) => {
      const [destination, hookType] = key.split('::');
      return {
        platform,
        destination,
        audience: 'global',
        hook_type: hookType,
        style_key: inferStyleKey(rows),
        source_type: 'external_trend',
        sample_count: rows.length,
        avg_score: avg(rows, 'performance_score'),
        avg_er: avg(rows, 'engagement_rate'),
        avg_hook_words: avg(rows, 'hook_words'),
        avg_posting_hour: null,
        avg_emoji_count: avg(rows, 'emoji_count'),
        avg_hashtag_count: avg(rows, 'hashtag_count'),
        sample_first_lines: topFirstLines(rows),
        source_breakdown: {
          keywords: topValues(rows, 'keyword', 6),
          window_days: 14,
        },
        latest_captured_at: latest(rows, 'captured_at'),
      };
    });
}

async function buildOwnedThreadsFingerprints(): Promise<TrendSourceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('threads_learning_signals_14d')
    .select('audience, destination, hook_type, style_key, sample_count, avg_score, avg_er, avg_posting_hour, latest_captured_at')
    .order('avg_score', { ascending: false, nullsFirst: false })
    .limit(200);

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    platform: 'threads',
    destination: normalizeDimension(row.destination),
    audience: normalizeDimension(row.audience),
    hook_type: normalizeDimension(row.hook_type, 'unknown'),
    style_key: normalizeDimension(row.style_key, 'general'),
    source_type: 'owned_performance',
    sample_count: Number(row.sample_count ?? 0),
    avg_score: asNumber(row.avg_score),
    avg_er: asNumber(row.avg_er),
    avg_hook_words: null,
    avg_posting_hour: asNumber(row.avg_posting_hour),
    avg_emoji_count: null,
    avg_hashtag_count: null,
    sample_first_lines: [],
    source_breakdown: { source: 'threads_learning_signals_14d' },
    latest_captured_at: typeof row.latest_captured_at === 'string' ? row.latest_captured_at : null,
  }));
}

function normalizeFingerprint(row: Record<string, unknown>): TrendStyleFingerprint {
  return {
    platform: row.platform === 'instagram' ? 'instagram' : 'threads',
    destination: normalizeDimension(row.destination),
    audience: normalizeDimension(row.audience),
    hook_type: normalizeDimension(row.hook_type, 'unknown'),
    style_key: normalizeDimension(row.style_key, 'general'),
    source_type: row.source_type === 'owned_performance' ? 'owned_performance' : row.source_type === 'mixed' ? 'mixed' : 'external_trend',
    sample_count: Number(row.sample_count ?? 0),
    avg_score: asNumber(row.avg_score),
    avg_er: asNumber(row.avg_er),
    avg_hook_words: asNumber(row.avg_hook_words),
    avg_posting_hour: asNumber(row.avg_posting_hour),
    avg_emoji_count: asNumber(row.avg_emoji_count),
    avg_hashtag_count: asNumber(row.avg_hashtag_count),
    sample_first_lines: Array.isArray(row.sample_first_lines)
      ? row.sample_first_lines.filter((v): v is string => typeof v === 'string')
      : [],
    source_breakdown: isRecord(row.source_breakdown) ? row.source_breakdown : {},
    latest_captured_at: typeof row.latest_captured_at === 'string' ? row.latest_captured_at : null,
  };
}

function normalizeDimension(value: unknown, fallback = 'global'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : fallback;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(rows: Array<Record<string, unknown>>, key: string): number | null {
  const nums = rows.map((row) => asNumber(row[key])).filter((n): n is number => n != null);
  if (nums.length === 0) return null;
  return round(nums.reduce((sum, n) => sum + n, 0) / nums.length, 4);
}

function latest(rows: Array<Record<string, unknown>>, key: string): string | null {
  const values = rows
    .map((row) => (typeof row[key] === 'string' ? row[key] as string : null))
    .filter((v): v is string => Boolean(v))
    .sort();
  return values.length > 0 ? values[values.length - 1] : null;
}

function topFirstLines(rows: Array<Record<string, unknown>>): string[] {
  return rows
    .filter((row) => typeof row.hook_first_line === 'string')
    .sort((a, b) => (asNumber(b.performance_score) ?? 0) - (asNumber(a.performance_score) ?? 0))
    .map((row) => (row.hook_first_line as string).slice(0, 160))
    .filter(Boolean)
    .slice(0, 5);
}

function topValues(rows: Array<Record<string, unknown>>, key: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = typeof row[key] === 'string' ? row[key] as string : null;
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function inferStyleKey(rows: Array<Record<string, unknown>>): string {
  const avgHookWords = avg(rows, 'hook_words') ?? 0;
  const avgEmoji = avg(rows, 'emoji_count') ?? 0;
  const avgHashtags = avg(rows, 'hashtag_count') ?? 0;
  if (avgHookWords <= 8 && avgEmoji <= 1) return 'short_hook';
  if (avgHashtags >= 2) return 'tagged_info';
  if (avgEmoji >= 2) return 'casual_story';
  return 'general';
}

function round(value: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
