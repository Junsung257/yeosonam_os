import { NextRequest, NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

type AnalyticsRow = Record<string, unknown> & {
  slug?: string | null;
  traffic_count?: number | null;
  first_touch_conversions?: number | null;
  first_touch_revenue?: number | null;
  first_touch_profit?: number | null;
};

type SearchAggregate = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  opportunityScore: number;
  improvementAction: string;
};

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split('T')[0];
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function buildImprovementAction(input: {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
}): { action: string; score: number } {
  const { impressions, clicks, ctr, position } = input;
  const pos = position ?? 999;

  if (impressions >= 50 && ctr < 0.02 && pos <= 12) {
    return {
      action: 'title_meta_ctr_repair',
      score: Math.round(impressions * (0.03 - ctr) + Math.max(0, 13 - pos) * 8),
    };
  }
  if (impressions >= 40 && clicks === 0 && pos <= 20) {
    return {
      action: 'intent_answer_refresh',
      score: Math.round(impressions * 0.8 + Math.max(0, 21 - pos) * 4),
    };
  }
  if (impressions >= 30 && ctr >= 0.05 && clicks >= 2) {
    return {
      action: 'expand_winner_cluster',
      score: Math.round(clicks * 12 + impressions * ctr),
    };
  }
  if (impressions >= 30 && pos > 10 && pos <= 25) {
    return {
      action: 'content_depth_refresh',
      score: Math.round(impressions * 0.4 + Math.max(0, 26 - pos) * 3),
    };
  }
  return { action: 'monitor', score: 0 };
}

async function loadSearchAggregates(slugs: string[], lookbackDays: number): Promise<Map<string, SearchAggregate>> {
  if (slugs.length === 0) return new Map();

  const { data } = await supabaseAdmin
    .from('rank_history')
    .select('slug, query, impressions, clicks, ctr, position, source')
    .in('slug', slugs)
    .gte('date', daysAgoDate(lookbackDays))
    .in('source', ['gsc-page', 'gsc']);

  const grouped = new Map<string, {
    clicks: number;
    impressions: number;
    weightedPosition: number;
    positionWeight: number;
  }>();

  for (const row of data || []) {
    const slug = String((row as Record<string, unknown>).slug || '');
    if (!slug) continue;
    const impressions = safeNumber((row as Record<string, unknown>).impressions);
    const clicks = safeNumber((row as Record<string, unknown>).clicks);
    const position = safeNumber((row as Record<string, unknown>).position);
    const weight = impressions > 0 ? impressions : 1;
    const current = grouped.get(slug) ?? {
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      positionWeight: 0,
    };
    current.clicks += clicks;
    current.impressions += impressions;
    current.weightedPosition += position * weight;
    current.positionWeight += weight;
    grouped.set(slug, current);
  }

  const aggregates = new Map<string, SearchAggregate>();
  for (const [slug, row] of grouped) {
    const position = row.positionWeight > 0 ? row.weightedPosition / row.positionWeight : null;
    const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    const improvement = buildImprovementAction({
      impressions: row.impressions,
      clicks: row.clicks,
      ctr,
      position,
    });
    aggregates.set(slug, {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr,
      position,
      opportunityScore: improvement.score,
      improvementAction: improvement.action,
    });
  }
  return aggregates;
}

function attachSearchMetrics(rows: AnalyticsRow[], searchMap: Map<string, SearchAggregate>): AnalyticsRow[] {
  return rows.map((row) => {
    const slug = row.slug ? String(row.slug) : null;
    const search = slug ? searchMap.get(slug) : null;
    return {
      ...row,
      search_clicks: search?.clicks ?? 0,
      search_impressions: search?.impressions ?? 0,
      search_ctr: search ? +(search.ctr * 100).toFixed(2) : 0,
      search_position: search?.position !== null && search?.position !== undefined
        ? +search.position.toFixed(1)
        : null,
      search_opportunity_score: search?.opportunityScore ?? 0,
      improvement_action: search?.improvementAction ?? 'monitor',
    };
  });
}

function buildSearchKpi(rows: AnalyticsRow[]) {
  const totalClicks = rows.reduce((sum, row) => sum + safeNumber(row.search_clicks), 0);
  const totalImpressions = rows.reduce((sum, row) => sum + safeNumber(row.search_impressions), 0);
  const positionedRows = rows.filter((row) =>
    safeNumber(row.search_impressions) > 0 && safeNumber(row.search_position) > 0,
  );
  const weightedPosition = positionedRows.reduce((sum, row) => (
    sum + safeNumber(row.search_position) * safeNumber(row.search_impressions)
  ), 0);
  const weight = positionedRows.reduce((sum, row) => sum + safeNumber(row.search_impressions), 0);
  const opportunities = rows
    .filter((row) => String(row.improvement_action || 'monitor') !== 'monitor')
    .sort((a, b) => safeNumber(b.search_opportunity_score) - safeNumber(a.search_opportunity_score))
    .slice(0, 10);

  return {
    search_tracked: rows.some((row) => safeNumber(row.search_impressions) > 0),
    total_search_clicks: totalClicks,
    total_search_impressions: totalImpressions,
    avg_search_ctr: totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0,
    avg_search_position: weight > 0 ? +(weightedPosition / weight).toFixed(1) : null,
    opportunity_count: opportunities.length,
  };
}

async function enrichAnalytics(rows: AnalyticsRow[], lookbackDays: number) {
  const slugs = Array.from(new Set(
    rows.map((row) => row.slug).filter((slug): slug is string => typeof slug === 'string' && slug.length > 0),
  ));
  const searchMap = await loadSearchAggregates(slugs, lookbackDays);
  const analytics = attachSearchMetrics(rows, searchMap);
  const improvementQueue = analytics
    .filter((row) => String(row.improvement_action || 'monitor') !== 'monitor')
    .sort((a, b) => safeNumber(b.search_opportunity_score) - safeNumber(a.search_opportunity_score))
    .slice(0, 10)
    .map((row) => ({
      slug: row.slug,
      seo_title: row.seo_title,
      destination: row.destination,
      search_impressions: row.search_impressions,
      search_clicks: row.search_clicks,
      search_ctr: row.search_ctr,
      search_position: row.search_position,
      score: row.search_opportunity_score,
      action: row.improvement_action,
    }));

  return {
    analytics,
    searchKpi: buildSearchKpi(analytics),
    improvementQueue,
  };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ analytics: [] });

  const { searchParams } = request.nextUrl;
  const limit = intParam(searchParams.get('limit'), 50, 1, 100);
  const destination = searchParams.get('destination');
  const lookbackDays = intParam(searchParams.get('lookback_days'), 28, 7, 90);

  try {
    let query = supabaseAdmin
      .from('content_roas_summary')
      .select('*')
      .order('traffic_count', { ascending: false })
      .limit(limit);

    if (destination) query = query.eq('destination', destination);

    const { data: viewData, error: viewError } = await query;

    if (!viewError && viewData) {
      const baseRows = viewData as AnalyticsRow[];
      const enriched = await enrichAnalytics(baseRows, lookbackDays);
      const totalTraffic = baseRows.reduce((s, r) => s + safeNumber(r.traffic_count), 0);
      const totalFirstConv = baseRows.reduce((s, r) => s + safeNumber(r.first_touch_conversions), 0);
      const totalRevenue = baseRows.reduce((s, r) => s + safeNumber(r.first_touch_revenue), 0);
      const totalProfit = baseRows.reduce((s, r) => s + safeNumber(r.first_touch_profit), 0);

      return NextResponse.json({
        analytics: enriched.analytics,
        kpi: {
          total_published: baseRows.length,
          total_traffic: totalTraffic,
          total_first_touch_conversions: totalFirstConv,
          total_revenue: totalRevenue,
          total_profit: totalProfit,
          avg_conversion_rate: totalTraffic > 0 ? ((totalFirstConv / totalTraffic) * 100).toFixed(2) : '0.00',
          ...enriched.searchKpi,
        },
        search_kpi: enriched.searchKpi,
        improvement_queue: enriched.improvementQueue,
      }, { headers: cacheHeader(60) });
    }

    const { data: creatives } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, angle_type, product_id, published_at, travel_packages(title, destination)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(limit);

    const baseRows = (creatives || []).map((c: Record<string, unknown>) => ({
      creative_id: c.id,
      slug: c.slug,
      seo_title: c.seo_title,
      angle_type: c.angle_type,
      product_id: c.product_id,
      package_title: c.travel_packages ? (c.travel_packages as Record<string, unknown>).title : null,
      destination: c.travel_packages ? (c.travel_packages as Record<string, unknown>).destination : null,
      published_at: c.published_at,
      traffic_count: 0,
      first_touch_conversions: 0,
      first_touch_revenue: 0,
      first_touch_cost: 0,
      first_touch_profit: 0,
      last_touch_conversions: 0,
      last_touch_revenue: 0,
    })) as AnalyticsRow[];
    const enriched = await enrichAnalytics(baseRows, lookbackDays);

    return NextResponse.json({
      analytics: enriched.analytics,
      kpi: {
        total_published: baseRows.length,
        total_traffic: 0,
        total_first_touch_conversions: 0,
        total_revenue: 0,
        total_profit: 0,
        avg_conversion_rate: '0.00',
        ...enriched.searchKpi,
      },
      search_kpi: enriched.searchKpi,
      improvement_queue: enriched.improvementQueue,
    }, { headers: cacheHeader(60) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'content analytics query failed' },
      { status: 500 },
    );
  }
}
