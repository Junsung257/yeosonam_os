import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 순위 대시보드 데이터 API
 *   GET ?days=14   → 최근 N일 요약
 *   GET ?slug=xxx  → 특정 글 시계열
 *   GET ?view=alerts → 미해결 경보
 *   GET ?view=top_movers → 7일 vs 14일 대비 상승/하락 TOP
 */

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const sp = request.nextUrl.searchParams;
  const view = sp.get('view') || 'summary';
  const days = Math.min(60, parseInt(sp.get('days') || '14'));

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  try {
    if (view === 'alerts') {
      const { data } = await supabaseAdmin
        .from('rank_alerts')
        .select('*')
        .is('resolved_at', null)
        .order('detected_at', { ascending: false })
        .limit(50);
      return NextResponse.json({ alerts: data || [] });
    }

    if (sp.get('slug')) {
      const slug = sp.get('slug')!;
      const { data } = await supabaseAdmin
        .from('rank_history')
        .select('*')
        .eq('slug', slug)
        .gte('date', sinceStr)
        .order('date', { ascending: true });
      return NextResponse.json({ slug, history: data || [] });
    }

    if (view === 'top_movers') {
      // 최근 14일 데이터 → slug+query 별 첫/끝 position 비교
      const { data } = await supabaseAdmin
        .from('rank_history')
        .select('slug, query, date, position, clicks, impressions')
        .gte('date', sinceStr)
        .order('date', { ascending: true });

      const groups = new Map<string, Array<any>>();
      for (const row of data || []) {
        const key = `${(row as any).slug}::${(row as any).query}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      const movers: Array<{
        slug: string;
        query: string;
        first_position: number;
        last_position: number;
        delta: number;
        impressions: number;
        clicks: number;
      }> = [];
      for (const [key, points] of groups) {
        if (points.length < 2) continue;
        const [slug, query] = key.split('::');
        const sorted = points.sort((a: any, b: any) => a.date.localeCompare(b.date));
        const first = sorted[0].position;
        const last = sorted[sorted.length - 1].position;
        const totalImpressions = sorted.reduce((a, b) => a + (b.impressions || 0), 0);
        const totalClicks = sorted.reduce((a, b) => a + (b.clicks || 0), 0);
        movers.push({
          slug, query,
          first_position: +first.toFixed(1),
          last_position: +last.toFixed(1),
          delta: +(last - first).toFixed(1),
          impressions: totalImpressions,
          clicks: totalClicks,
        });
      }

      const ups = movers.filter(m => m.delta < -1).sort((a, b) => a.delta - b.delta).slice(0, 20);
      const downs = movers.filter(m => m.delta > 1).sort((a, b) => b.delta - a.delta).slice(0, 20);

      return NextResponse.json({ ups, downs, total_tracked: movers.length });
    }

    // summary view: 최근 N일 누적 + Top performers
    const { data: history } = await supabaseAdmin
      .from('rank_history')
      .select('slug, query, position, clicks, impressions, date')
      .gte('date', sinceStr);

    const slugMap = new Map<string, { clicks: number; impressions: number; positions: number[]; queries: Set<string> }>();
    for (const row of history || []) {
      const r = row as any;
      const ex = slugMap.get(r.slug) || { clicks: 0, impressions: 0, positions: [], queries: new Set() };
      ex.clicks += r.clicks || 0;
      ex.impressions += r.impressions || 0;
      if (r.position) ex.positions.push(r.position);
      if (r.query) ex.queries.add(r.query);
      slugMap.set(r.slug, ex);
    }

    const top = Array.from(slugMap.entries())
      .map(([slug, m]) => ({
        slug,
        clicks: m.clicks,
        impressions: m.impressions,
        avg_position: m.positions.length > 0 ? +(m.positions.reduce((a, b) => a + b, 0) / m.positions.length).toFixed(1) : null,
        query_count: m.queries.size,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 30);

    const totals = {
      total_clicks: top.reduce((a, b) => a + b.clicks, 0),
      total_impressions: top.reduce((a, b) => a + b.impressions, 0),
      tracked_slugs: slugMap.size,
    };

    return NextResponse.json({ days, since: sinceStr, totals, top });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
