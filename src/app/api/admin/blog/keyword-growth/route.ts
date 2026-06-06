import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RankRow = {
  slug: string | null;
  query: string | null;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
};

type QueueRow = {
  id: string;
  topic: string | null;
  primary_keyword: string | null;
  keyword_tier: string | null;
  monthly_search_volume: number | null;
  competition_level: string | null;
  priority: number | null;
  status: string | null;
  destination: string | null;
  source: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

type PerformanceRow = {
  slug: string | null;
  traffic_count?: number | null;
  first_touch_conversions?: number | null;
  first_touch_revenue?: number | null;
  first_touch_profit?: number | null;
};

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function scoreQuery(rows: RankRow[]): number {
  const impressions = rows.reduce((sum, row) => sum + safeNumber(row.impressions), 0);
  const clicks = rows.reduce((sum, row) => sum + safeNumber(row.clicks), 0);
  const positionWeight = rows.reduce((sum, row) => sum + Math.max(1, safeNumber(row.impressions)), 0);
  const weightedPosition = rows.reduce((sum, row) => sum + safeNumber(row.position) * Math.max(1, safeNumber(row.impressions)), 0);
  const avgPosition = positionWeight > 0 ? weightedPosition / positionWeight : null;
  const positionScore = avgPosition ? Math.max(0, 30 - avgPosition) * 2 : 0;
  return Math.round((clicks * 80 + impressions * 0.35 + positionScore) * 10) / 10;
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 28), 7), 120);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 120), 20), 300);
  const warnings: string[] = [];

  const [rankRes, queueRes, perfRes] = await Promise.all([
    supabaseAdmin
      .from('rank_history')
      .select('slug, query, position, impressions, clicks, ctr')
      .gte('date', daysAgoDate(days))
      .neq('query', '__page__')
      .limit(limit * 20),
    supabaseAdmin
      .from('blog_topic_queue')
      .select('id, topic, primary_keyword, keyword_tier, monthly_search_volume, competition_level, priority, status, destination, source, meta, created_at')
      .in('source', ['gsc_longtail', 'programmatic_seo', 'coverage_gap', 'trend'])
      .order('created_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('content_roas_summary')
      .select('slug, traffic_count, first_touch_conversions, first_touch_revenue, first_touch_profit')
      .limit(limit * 3),
  ]);

  const firstHardError = rankRes.error || queueRes.error;
  if (firstHardError) {
    return apiResponse({ ok: false, error: sanitizeDbError(firstHardError) }, { status: 500 });
  }
  if (perfRes.error) warnings.push(`content_roas_summary unavailable: ${sanitizeDbError(perfRes.error)}`);

  let familyRes: { data: any[] | null; error: any } = { data: null, error: null };
  let memberRes: { data: any[] | null; error: any } = { data: null, error: null };
  try {
    familyRes = await supabaseAdmin
      .from('blog_keyword_families')
      .select('id, family_key, canonical_keyword, destination, intent, status, meta, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);
  } catch (error) {
    familyRes = { data: null, error };
  }

  try {
    memberRes = await supabaseAdmin
      .from('blog_keyword_family_members')
      .select('family_id, keyword, role, source, score, metrics, topic_queue_id, content_creative_id')
      .limit(limit * 5);
  } catch (error) {
    memberRes = { data: null, error };
  }

  if (familyRes.error) warnings.push(`keyword families unavailable: ${sanitizeDbError(familyRes.error)}`);
  if (memberRes.error) warnings.push(`keyword family members unavailable: ${sanitizeDbError(memberRes.error)}`);

  const rankRows = (rankRes.data || []) as RankRow[];
  const queueRows = (queueRes.data || []) as QueueRow[];
  const perfRows = (perfRes.data || []) as PerformanceRow[];
  const perfBySlug = new Map(perfRows.filter((row) => row.slug).map((row) => [row.slug as string, row]));

  const queryGroups = new Map<string, RankRow[]>();
  for (const row of rankRows) {
    const query = row.query?.trim();
    if (!query) continue;
    const key = `${query.toLowerCase()}::${row.slug || ''}`;
    const rows = queryGroups.get(key) || [];
    rows.push(row);
    queryGroups.set(key, rows);
  }

  const topQueries = [...queryGroups.values()]
    .map((rows) => {
      const latest = rows[0];
      const impressions = rows.reduce((sum, row) => sum + safeNumber(row.impressions), 0);
      const clicks = rows.reduce((sum, row) => sum + safeNumber(row.clicks), 0);
      const weightedPosition = rows.reduce((sum, row) => sum + safeNumber(row.position) * Math.max(1, safeNumber(row.impressions)), 0);
      const positionWeight = rows.reduce((sum, row) => sum + Math.max(1, safeNumber(row.impressions)), 0);
      const performance = latest.slug ? perfBySlug.get(latest.slug) : null;
      return {
        query: latest.query,
        slug: latest.slug,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
        avg_position: positionWeight > 0 ? Math.round((weightedPosition / positionWeight) * 10) / 10 : null,
        opportunity_score: scoreQuery(rows) + safeNumber(performance?.first_touch_conversions) * 100,
        revenue_score: safeNumber(performance?.first_touch_profit) || safeNumber(performance?.first_touch_revenue),
      };
    })
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 40);

  const queueByFamily = new Map<string, QueueRow[]>();
  for (const row of queueRows) {
    const familyKey = typeof row.meta?.keyword_family_key === 'string' ? row.meta.keyword_family_key : 'unassigned';
    const rows = queueByFamily.get(familyKey) || [];
    rows.push(row);
    queueByFamily.set(familyKey, rows);
  }

  const families: Array<Record<string, any> & {
    member_count: number;
    queue_count: number;
    max_score: number;
    cannibalization_risk: 'low' | 'medium' | 'high';
    members: Array<Record<string, any>>;
  }> = ((familyRes.data || []) as Array<Record<string, any>>).map((family) => {
    const members = ((memberRes.data || []) as Array<Record<string, any>>).filter((member) => member.family_id === family.id);
    const queued = queueByFamily.get(String(family.family_key)) || [];
    return {
      ...family,
      member_count: members.length,
      queue_count: queued.length,
      max_score: Math.max(0, ...members.map((member) => safeNumber(member.score)), ...queued.map((row) => safeNumber(row.priority))),
      cannibalization_risk: members.some((member) => member.metrics?.cannibalization_risk === 'high') || queued.some((row) => row.meta?.cannibalization_risk === 'high')
        ? 'high'
        : members.length + queued.length >= 3 ? 'medium' : 'low',
      members: members.slice(0, 8),
    };
  });

  const cannibalizationWatch = [
    ...families.filter((family) => family.cannibalization_risk !== 'low'),
    ...[...queueByFamily.entries()]
      .filter(([familyKey, rows]) => familyKey !== 'unassigned' && rows.length >= 2)
      .map(([familyKey, rows]) => ({
        id: familyKey,
        family_key: familyKey,
        canonical_keyword: rows[0]?.primary_keyword,
        destination: rows[0]?.destination,
        status: 'watch',
        member_count: rows.length,
        queue_count: rows.length,
        max_score: Math.max(...rows.map((row) => safeNumber(row.priority))),
        cannibalization_risk: 'medium',
        members: [],
      })),
  ].slice(0, 30);

  const summary = {
    days,
    tracked_queries: queryGroups.size,
    gsc_longtail_queue: queueRows.filter((row) => row.source === 'gsc_longtail').length,
    active_families: families.filter((family) => family.status === 'active').length,
    cannibalization_watch: cannibalizationWatch.length,
    total_clicks: rankRows.reduce((sum, row) => sum + safeNumber(row.clicks), 0),
    total_impressions: rankRows.reduce((sum, row) => sum + safeNumber(row.impressions), 0),
    conversion_weighted_queries: topQueries.filter((row) => row.revenue_score > 0).length,
  };

  return apiResponse({
    ok: true,
    generated_at: new Date().toISOString(),
    warnings,
    summary,
    top_queries: topQueries,
    queue: queueRows,
    families,
    cannibalization_watch: cannibalizationWatch,
  });
});
