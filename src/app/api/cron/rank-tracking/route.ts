import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchBlogSearchMetrics, isGSCConfigured, extractSlugFromUrl } from '@/lib/gsc-client';
import { withCronLogging } from '@/lib/cron-observability';

/**
 * Rank Tracking — 매일 03:00 UTC 실행
 *
 * 흐름:
 *   1. 어제 날짜 GSC searchanalytics.query (page+query 차원, /blog/ 필터)
 *   2. rank_history 에 (slug, query, date, position, clicks, ctr) 누적
 *   3. 7일 평균 vs 어제 비교 → 5계단 이상 하락 시 rank_alerts INSERT
 *
 * Why:
 *   "검색량 강도 분석 + 본문 최적화 + 발행" 만으로는 ROI 못 봄.
 *   순위 추적까지 있어야 어떤 키워드 잡았는지/놓쳤는지 측정 가능.
 *
 * env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON (이미 사용 중) — Search Console API 권한
 *   GSC_SITE_URL (e.g., 'https://yeosonam.com/')
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const RANK_DROP_THRESHOLD = 5;       // 5계단 이상 하락 시 경보
const LOOKBACK_AVG_DAYS = 7;

async function runRankTracking(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  if (!isGSCConfigured()) {
    return { skipped: true, reason: 'GSC 미설정 (GOOGLE_SERVICE_ACCOUNT_JSON 필요)', errors: [] };
  }

  const siteUrl = process.env.GSC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com/';
  const errors: string[] = [];

  // 1) 어제 데이터 (GSC는 보통 1-2일 지연)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 2);
  const dateStr = targetDate.toISOString().split('T')[0];

  const metrics = await fetchBlogSearchMetrics(siteUrl, dateStr, true).catch(err => {
    errors.push(`GSC fetch 실패: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });

  if (metrics.length === 0) {
    return { date: dateStr, fetched: 0, inserted: 0, alerts: 0, errors, message: 'GSC 데이터 없음' };
  }

  // 2) rank_history 일괄 upsert (slug 추출)
  const rows = metrics
    .map(m => {
      const slug = extractSlugFromUrl(m.page);
      if (!slug || !m.query) return null;
      return {
        slug,
        query: m.query,
        date: dateStr,
        position: m.position,
        impressions: m.impressions,
        clicks: m.clicks,
        ctr: m.ctr,
        page_url: m.page,
        source: 'gsc',
      };
    })
    .filter(Boolean) as any[];

  let inserted = 0;
  if (rows.length > 0) {
    const { error: insErr } = await supabaseAdmin
      .from('rank_history')
      .upsert(rows, { onConflict: 'slug,query,date,source', ignoreDuplicates: false });
    if (insErr) errors.push(`rank_history upsert 실패: ${insErr.message}`);
    else inserted = rows.length;
  }

  // 3) 이탈 경보 — 7일 평균 vs 어제, 5계단 이상 하락
  let alerts = 0;
  const since = new Date(targetDate);
  since.setDate(since.getDate() - LOOKBACK_AVG_DAYS);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: history } = await supabaseAdmin
    .from('rank_history')
    .select('slug, query, date, position')
    .gte('date', sinceStr)
    .lte('date', dateStr)
    .order('date', { ascending: true });

  if (history && history.length > 0) {
    // (slug,query) 그룹핑
    const groups = new Map<string, Array<{ date: string; position: number }>>();
    for (const h of history as Array<{ slug: string; query: string; date: string; position: number }>) {
      const key = `${h.slug}::${h.query}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ date: h.date, position: h.position });
    }

    const alertRows: any[] = [];
    for (const [key, points] of groups) {
      if (points.length < 4) continue; // 데이터 부족
      const yesterday = points.find(p => p.date === dateStr);
      if (!yesterday) continue;

      // 직전 일자들 평균 (어제 제외)
      const prev = points.filter(p => p.date !== dateStr);
      if (prev.length === 0) continue;
      const avgPrev = prev.reduce((a, b) => a + b.position, 0) / prev.length;
      const delta = yesterday.position - avgPrev;

      if (delta >= RANK_DROP_THRESHOLD) {
        const [slug, query] = key.split('::');
        alertRows.push({
          slug,
          query,
          prev_position: +avgPrev.toFixed(1),
          curr_position: +yesterday.position.toFixed(1),
          delta: +delta.toFixed(1),
          meta: { lookback_days: LOOKBACK_AVG_DAYS, sample_count: prev.length },
        });
      }
    }

    if (alertRows.length > 0) {
      const { error: aErr } = await supabaseAdmin.from('rank_alerts').insert(alertRows);
      if (aErr) errors.push(`rank_alerts insert 실패: ${aErr.message}`);
      else alerts = alertRows.length;
    }
  }

  return {
    date: dateStr,
    fetched: metrics.length,
    inserted,
    alerts,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('rank-tracking', runRankTracking);
