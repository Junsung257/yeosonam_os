import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fetchBlogSearchMetrics, isGSCConfigured } from '@/lib/gsc-client';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { expandGscLongtailTopics } from '@/lib/blog-longtail-expander';
import { buildBlogGscQueryRankHistoryRows } from '@/lib/blog-gsc-rank-history-rows';
import { buildBlogGscSearchPerformanceRowsV3 } from '@/lib/blog-search-performance-import-v3';
import {
  buildBlogGscCollectionPlanV3,
  readBlogGscBackfillCursorV3,
} from '@/lib/blog-gsc-collection-plan-v3';

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

async function upsertInChunks(
  table: 'rank_history' | 'blog_search_performance',
  rows: Array<Record<string, unknown>>,
  onConflict: string,
): Promise<{ inserted: number; error: string | null }> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, {
      onConflict,
      ignoreDuplicates: false,
    });
    if (error) return { inserted, error: sanitizeDbError(error) };
    inserted += chunk.length;
  }
  return { inserted, error: null };
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runRankTracking(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  if (!isGSCConfigured()) {
    return { skipped: true, reason: 'GSC 미설정 (GOOGLE_SERVICE_ACCOUNT_JSON 필요)', errors: [] as string[] };
  }

  const siteUrl = process.env.GSC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com/';
  const errors: string[] = [];

  // 1) 최근 7일은 매번 재수집하고, 그 이전 90일은 작은 청크로
  //    역방향 보강한다. GSC 수정 데이터도 반영하면서 한 번의 크론이
  //    과도한 API 호출이나 함수 시간을 쓰지 않게 한다.
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 2);
  const dateStr = targetDate.toISOString().split('T')[0];
  const previousRuns = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('cron_name', 'rank-tracking')
    .order('started_at', { ascending: false })
    .limit(20);
  const priorRows = previousRuns.error ? [] : previousRuns.data || [];
  const hasPreviousBackfillState = priorRows.some((row: any) => (
    row?.summary?.gsc_collection
    && Object.prototype.hasOwnProperty.call(row.summary.gsc_collection, 'nextBackfillEndDate')
  ));
  const previousBackfillEndDate = readBlogGscBackfillCursorV3(priorRows);
  const collectionPlan = buildBlogGscCollectionPlanV3({
    now: new Date(),
    catchupDays: Number(process.env.BLOG_GSC_CATCHUP_DAYS || 7),
    backfillDays: Number(process.env.BLOG_GSC_BACKFILL_DAYS || 90),
    backfillChunkDays: Number(process.env.BLOG_GSC_BACKFILL_CHUNK_DAYS || 7),
    previousBackfillEndDate,
    hasPreviousState: hasPreviousBackfillState,
  });
  const targetDates = collectionPlan.requestedDates;
  const metrics = [] as Awaited<ReturnType<typeof fetchBlogSearchMetrics>>;
  const failedDates: string[] = [];
  for (const target of targetDates) {
    const daily = await fetchBlogSearchMetrics(siteUrl, target, true).catch(err => {
      errors.push(`GSC fetch failed (${target}): ${sanitizeDbError(err)}`);
      failedDates.push(target);
      return [];
    });
    metrics.push(...daily);
  }
  const gscCollection = {
    ...collectionPlan,
    nextBackfillEndDate: failedDates.length > 0
      ? (hasPreviousBackfillState ? previousBackfillEndDate : collectionPlan.backfillDates.at(-1) ?? null)
      : collectionPlan.nextBackfillEndDate,
    fetchedDates: targetDates.filter((date) => !failedDates.includes(date)),
    failedDates,
    stateReadError: previousRuns.error ? sanitizeDbError(previousRuns.error) : null,
  };
  const selectedGscSiteUrl = metrics[0]?.gscSiteUrl ?? siteUrl;

  if (metrics.length === 0) {
    errors.push(`gsc_observed_metrics_empty:${targetDates[0]}:${dateStr}`);
    return {
      ok: false,
      date: dateStr,
      catchup_days: collectionPlan.catchupDates.length,
      gsc_collection: gscCollection,
      fetched: 0,
      inserted: 0,
      performance_inserted: 0,
      alerts: 0,
      errors,
      message: 'GSC observed query-page metrics are empty',
    };
  }

  // 2) rank_history 일괄 upsert (slug 추출)
  const rows = targetDates.flatMap((date) => buildBlogGscQueryRankHistoryRows(
    metrics.filter((metric) => metric.date === date),
    date,
  ));

  let inserted = 0;
  if (rows.length > 0) {
    const result = await upsertInChunks(
      'rank_history',
      rows as unknown as Array<Record<string, unknown>>,
      'slug,query,date,source',
    );
    inserted = result.inserted;
    if (result.error) errors.push(`rank_history upsert failed: ${result.error}`);
  }

  const performanceRows = buildBlogGscSearchPerformanceRowsV3(
    metrics,
    `gsc-api-${targetDates[0]}-${dateStr}`,
  );
  const performanceResult = await upsertInChunks(
    'blog_search_performance',
    performanceRows as unknown as Array<Record<string, unknown>>,
    'provider,source_row_hash',
  );
  if (performanceResult.error) {
    errors.push(`blog_search_performance upsert failed: ${performanceResult.error}`);
  }

  let longtailExpansion: Record<string, unknown> | null = null;
  if (inserted > 0) {
    try {
      const result = await withTimeout(
        expandGscLongtailTopics({
          dryRun: false,
          limit: 5,
          seedLimit: 20,
          lookbackDays: 28,
          maxCandidatesPerSeed: 4,
          recentDedupDays: 90,
          minSeedImpressions: 5,
          minSeedClicks: 1,
          maxAvgPosition: 25,
        }),
        60_000,
      );
      if (!result) {
        errors.push('blog longtail expansion timed out after rank history update');
      } else {
        longtailExpansion = {
          inserted: result.inserted,
          candidate_count: result.candidates.length,
          skipped_count: result.skipped.length,
          error_count: result.errors.length,
        };
        errors.push(...result.errors.map((error) => `blog longtail expansion: ${sanitizeDbError(error)}`));
      }
    } catch (err) {
      errors.push(`blog longtail expansion failed: ${sanitizeDbError(err)}`);
    }
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
      if (aErr) {
        errors.push(`rank_alerts insert failed: ${sanitizeDbError(aErr)}`);
      } else {
        alerts = alertRows.length;
      }
    }
  }

  return {
    ok: errors.length === 0,
    date: dateStr,
    catchup_days: collectionPlan.catchupDates.length,
    requested_dates: targetDates,
    gsc_collection: gscCollection,
    fetched: metrics.length,
    inserted,
    performance_inserted: performanceResult.inserted,
    alerts,
    siteUrl: selectedGscSiteUrl,
    fallback_used: selectedGscSiteUrl !== siteUrl,
    longtail_expansion: longtailExpansion,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('rank-tracking', runRankTracking, {
  handlerTimeoutMs: 285_000,
  sideEffectTimeoutMs: 10_000,
});
