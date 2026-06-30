import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';
import { countPublishableQueueCandidates, normalizeDailyPostTarget } from '@/lib/blog-scheduler';
import { getClosedKstDailySummaryRange } from '@/lib/blog-daily-summary-window';

/**
 * 일일 발행 요약 + 저성과 글 자동 재생성 트리거.
 * Runs after the final daily blog-publisher slot, so the report covers today's
 * completed KST publishing window instead of a morning pre-publish snapshot.
 *
 * 1) 어제 발행 통계 → publishing_policies.daily_summary_webhook 으로 push
 * 2) auto_regenerate_underperformers ON 시:
 *    - 7일 이상 발행 + GSC 클릭 0건 → 큐에 user_seed priority=85 재생성
 *    - 단, 14일 윈도 dedup 통과한 것만
 */

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MIN_DAILY_SUMMARY_ALERT_POSTS = 3;

async function insertDedupedBlogAlert(input: {
  severity: string;
  title: string;
  message: string;
  refType: string;
  refId: string;
  meta: Record<string, unknown>;
  dedupeOpenByRefType?: boolean;
}): Promise<void> {
  let existingQuery = supabaseAdmin
    .from('admin_alerts')
    .select('id')
    .eq('category', 'blog')
    .eq('ref_type', input.refType)
    .is('acknowledged_at', null)
    .limit(1);
  if (!input.dedupeOpenByRefType) {
    existingQuery = existingQuery.eq('ref_id', input.refId);
  }
  const { data: existing } = await existingQuery;
  if (existing && existing.length > 0) return;

  await supabaseAdmin.from('admin_alerts').insert({
    category: 'blog',
    severity: input.severity,
    title: input.title,
    message: input.message,
    ref_type: input.refType,
    ref_id: input.refId,
    meta: input.meta,
  });
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isGoogleIndexedReport(report: any): boolean {
  if (report?.google_status === 'indexed') return true;
  if (report?.google_index_verdict === 'PASS') return true;
  const coverage = String(report?.google_coverage_state || '').toLowerCase();
  return coverage.includes('indexed')
    || coverage.includes('색인이 생성')
    || coverage.includes('색인 생성');
}

type BlogOpsWatcherIssue = {
  code: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  title: string;
  detail: string;
  recommendation: string;
};

function buildBlogOpsWatcherReport(summary: any, sourceErrors: string[]): {
  agent: 'blog_ops_watcher';
  level: 'healthy' | 'watch' | 'risk' | 'blocked';
  issue_count: number;
  issues: BlogOpsWatcherIssue[];
  next_action: string;
} {
  const issues: BlogOpsWatcherIssue[] = [];

  if (sourceErrors.includes('daily_summary_source_queries_timed_out')) {
    issues.push({
      code: 'source_queries_timed_out',
      severity: 'critical',
      title: 'Blog data source timed out',
      detail: 'Daily summary source queries timed out, so publish counts and queue status may be incomplete.',
      recommendation: 'Check Supabase REST/Data API health before judging publish success or running bulk repairs.',
    });
  }

  if (summary.under_daily_target || summary.published < MIN_DAILY_SUMMARY_ALERT_POSTS) {
    issues.push({
      code: 'daily_publish_sla_miss',
      severity: summary.published === 0 ? 'critical' : 'high',
      title: 'Daily blog publish target missed',
      detail: `Published ${summary.published}/${summary.min_daily_target} posts for ${summary.date} KST.`,
      recommendation: 'Inspect blog-publisher, active queue rows, and recent quality-gate failures before requeueing.',
    });
  }

  if (summary.publisher_cron && summary.publisher_cron.ran_today === false) {
    issues.push({
      code: 'publisher_cron_not_observed',
      severity: 'critical',
      title: 'Blog publisher cron did not run today',
      detail: `No blog-publisher cron run was recorded for ${summary.date} KST. Last run: ${summary.publisher_cron.last_run_at ?? 'unknown'}.`,
      recommendation: 'Check Vercel Cron delivery, Deployment Protection bypass, and CRON_SECRET before manually forcing publication.',
    });
  }

  if (summary.queue_failed > 0) {
    issues.push({
      code: 'queue_failures_present',
      severity: 'high',
      title: 'Blog queue has failed rows',
      detail: `${summary.queue_failed} failed queue rows are present.`,
      recommendation: 'Group failures by failure_code, fix repeat classes, then requeue only retryable rows.',
    });
  }

  const duplicateFailures = Number(summary.failure_breakdown?.publisher?.duplicate ?? 0);
  if (duplicateFailures > 0) {
    issues.push({
      code: 'duplicate_failures_present',
      severity: 'high',
      title: 'Duplicate blog candidates blocked publishing',
      detail: `${duplicateFailures} publisher candidates were blocked by duplicate checks.`,
      recommendation: 'Keep the duplicate gate enabled and refill with destination + micro_angle candidates instead of retrying skipped topics.',
    });
  }

  if (Array.isArray(summary.search_standard?.health_issues) && summary.search_standard.health_issues.length > 0) {
    issues.push({
      code: 'search_visibility_issues',
      severity: 'warning',
      title: 'Search visibility needs attention',
      detail: summary.search_standard.health_issues.join(', '),
      recommendation: 'Separate publish health from indexing/ranking health; verify GSC, IndexNow, sitemap, and rank snapshots.',
    });
  }

  if (summary.under_daily_target && summary.queue_pending === 0) {
    issues.push({
      code: 'publish_queue_empty',
      severity: 'high',
      title: 'Blog publish queue appears empty',
      detail: 'The daily target was missed and no queued rows were counted.',
      recommendation: 'Run topic generation/scheduler after confirming the DB source is healthy.',
    });
  }

  const hasCritical = issues.some((issue) => issue.severity === 'critical');
  const hasHigh = issues.some((issue) => issue.severity === 'high');
  const hasWarning = issues.some((issue) => issue.severity === 'warning');
  const level = hasCritical ? 'blocked' : hasHigh ? 'risk' : hasWarning ? 'watch' : 'healthy';
  const nextAction = issues[0]?.recommendation ?? 'No action needed. Keep the daily publishing and indexing checks running.';

  return {
    agent: 'blog_ops_watcher',
    level,
    issue_count: issues.length,
    issues,
    next_action: nextAction,
  };
}

async function runDailySummary(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const resourceSaver = maybeSkipNonCriticalCron(request, 'blog-daily-summary');
  if (resourceSaver) return resourceSaver;

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // 정책 조회
  const { data: policyRow } = await withTimeout(
    supabaseAdmin
      .from('publishing_policies')
      .select('*')
      .eq('scope', 'global')
      .limit(1),
    8_000,
    { data: null } as any,
  );
  const policy = policyRow?.[0];
  const dailyTarget = normalizeDailyPostTarget(policy?.posts_per_day ?? process.env.BLOG_DAILY_PUBLISH_TARGET);

  // Report the latest closed KST publishing day. If the route is delayed past
  // midnight or called manually before 22:12 KST, it must not evaluate the new
  // in-progress day as an SLA failure.
  const reportDay = getClosedKstDailySummaryRange();
  const recentSearchStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const summaryFallback = [
    { data: [], count: 0 },
    { data: [], count: 0 },
    { data: [], count: 0 },
    { data: [], count: 0 },
    { data: null, count: 0 },
    { data: null, count: 0 },
    { data: [], count: 0 },
    { data: [], count: 0 },
  ] as any;
  const summaryResults = await withTimeout(Promise.all([
    supabaseAdmin.from('content_creatives').select('id, slug, content_type, destination, readability_score', { count: 'exact' })
      .eq('channel', 'naver_blog').eq('status', 'published')
      .gte('published_at', reportDay.start.toISOString()).lt('published_at', reportDay.end.toISOString()),
    supabaseAdmin.from('blog_topic_queue').select('id, status, product_id, destination, angle_type, topic, source, meta', { count: 'exact' })
      .in('status', ['queued', 'generating', 'failed']),
    supabaseAdmin.from('rank_alerts').select('id', { count: 'exact' })
      .is('resolved_at', null),
    supabaseAdmin.from('indexing_reports').select('google_status, google_error, indexnow_status, indexnow_error, sitemap_pings, google_index_verdict, google_coverage_state')
      .gte('reported_at', recentSearchStart.toISOString())
      .order('reported_at', { ascending: false })
      .limit(200),
    supabaseAdmin.from('blog_visibility_snapshots').select('id', { count: 'exact', head: true })
      .gte('checked_at', recentSearchStart.toISOString()),
    supabaseAdmin.from('rank_history').select('slug', { count: 'exact', head: true })
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0]),
    supabaseAdmin.from('cron_health').select('cron_name, last_status, last_run_at, last_error_count, last_summary')
      .eq('cron_name', 'blog-publisher')
      .limit(1),
    supabaseAdmin.from('content_creatives').select('destination, angle_type, slug, product_id, generation_meta')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .limit(300),
  ]), 18_000, summaryFallback);
  if (summaryResults === summaryFallback) {
    errors.push('daily_summary_source_queries_timed_out');
  }
  const [pubRes, queueRes, alertRes, indexRes, visibilityRes, rankRes, publisherCronRes, recentPublishedRes] = summaryResults;

  const published = pubRes.data || [];
  const indexReports = indexRes.data || [];
  const indexSuccess = indexReports.filter((r: any) => r.google_status === 'success' || r.indexnow_status === 'success').length;
  const indexRate = indexReports.length > 0 ? (indexSuccess / indexReports.length) * 100 : 0;
  const googleInspectionReports = indexReports.filter((r: any) =>
    ['indexed', 'not_indexed'].includes(String(r.google_status || '')) || r.google_index_verdict,
  );
  const googleIndexed = googleInspectionReports.filter(isGoogleIndexedReport).length;
  const googleNotIndexed = googleInspectionReports.filter((r: any) => !isGoogleIndexedReport(r)).length;
  const googleIndexedRate = googleInspectionReports.length > 0
    ? +((googleIndexed / googleInspectionReports.length) * 100).toFixed(1)
    : null;

  const providerStats = indexReports.reduce((acc: Record<string, { total: number; ok: number }>, report: any) => {
    const pings = Array.isArray(report?.sitemap_pings) ? report.sitemap_pings : [];
    for (const ping of pings) {
      const provider = String(ping?.provider || '');
      if (!provider) continue;
      const stats = acc[provider] ?? { total: 0, ok: 0 };
      stats.total += 1;
      if (ping?.ok === true) stats.ok += 1;
      acc[provider] = stats;
    }
    return acc;
  }, {});

  const providerRate = (provider: string): number | null => {
    const stats = providerStats[provider];
    if (!stats || stats.total === 0) return null;
    return +((stats.ok / stats.total) * 100).toFixed(1);
  };

  const googleSitemapSuccessRate = providerRate('google_search_console_sitemap');
  const naverIndexNowSuccessRate = providerRate('naver_indexnow');
  const globalIndexNowSuccessRate = providerRate('global_indexnow');
  const searchHealthIssues: string[] = [];
  if (googleSitemapSuccessRate !== null && googleSitemapSuccessRate < 80) {
    searchHealthIssues.push(`google_sitemap_low:${googleSitemapSuccessRate}%`);
  }
  if (naverIndexNowSuccessRate !== null && naverIndexNowSuccessRate < 80) {
    searchHealthIssues.push(`naver_indexnow_low:${naverIndexNowSuccessRate}%`);
  }
  if ((visibilityRes.count || 0) === 0) {
    searchHealthIssues.push('visibility_snapshots_missing');
  }
  if ((rankRes.count || 0) === 0) {
    searchHealthIssues.push('rank_history_missing_30d');
  }
  if (googleInspectionReports.length > 0 && googleIndexedRate !== null && googleIndexedRate < 20) {
    searchHealthIssues.push(`google_actual_index_low:${googleIndexedRate}%`);
  }

  const queueCounts = (queueRes.data || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const publishabilityStats = countPublishableQueueCandidates({
    activeQueue: (queueRes.data || []).filter((row: any) => row.status === 'queued' || row.status === 'generating'),
    recentPublished: recentPublishedRes.data || [],
  });
  const publishability = {
    queued_total: (queueRes.data || []).filter((row: any) => row.status === 'queued' || row.status === 'generating').length,
    publishable_candidate_count: publishabilityStats.publishableCount,
    duplicate_candidate_count: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidence_insufficient_count: publishabilityStats.evidenceInsufficient,
    candidate_shortage: publishabilityStats.publishableCount < dailyTarget * 2,
    next_action: publishabilityStats.evidenceInsufficient > 0
      ? 'collect_evidence'
      : publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued > 0
        ? 'quarantine_duplicates'
        : publishabilityStats.publishableCount < dailyTarget * 2
          ? 'refill_candidates'
          : 'publish_ready',
  };

  // destination별 발행 분포
  const destDist: Record<string, number> = {};
  for (const p of published as unknown as Array<Record<string, unknown>>) {
    const dest = p.destination as string | undefined;
    if (dest) destDist[dest] = (destDist[dest] || 0) + 1;
  }

  // 가독성 평균
  const readabilityScores = (published as unknown as Array<{ readability_score?: number }>).map(p => p.readability_score).filter((s): s is number => s !== undefined && s !== null);
  const avgReadability = readabilityScores.length > 0
    ? Math.round(readabilityScores.reduce((a, b) => a + b, 0) / readabilityScores.length)
    : null;
  const publisherCron = publisherCronRes.data?.[0] || null;
  const publisherSummary = publisherCron?.last_summary && typeof publisherCron.last_summary === 'object'
    ? publisherCron.last_summary as Record<string, any>
    : {};
  const failureBreakdown = publisherSummary.failure_breakdown && typeof publisherSummary.failure_breakdown === 'object'
    ? publisherSummary.failure_breakdown
    : {};
  const publisherLastRunAt = publisherCron?.last_run_at ? new Date(publisherCron.last_run_at) : null;
  const publisherRanToday = publisherLastRunAt
    ? publisherLastRunAt >= reportDay.start && publisherLastRunAt < reportDay.end
    : false;
  const dailySummarySlot = new Date(reportDay.start.getTime() + ((22 * 60) + 12) * 60 * 1000);
  const postSummaryPublisherRun = publisherLastRunAt
    ? publisherLastRunAt > dailySummarySlot && publisherLastRunAt < reportDay.end
    : false;

  const summary = {
    date: reportDay.dayKey,
    timezone: 'Asia/Seoul',
    generated_at: new Date().toISOString(),
    report_period_closed: reportDay.closed,
    used_previous_day_for_pre_close_run: reportDay.usedPreviousDay,
    close_minute_kst: reportDay.closeMinuteKst,
    published: pubRes.count || 0,
    min_daily_target: dailyTarget,
    under_daily_target: (pubRes.count || 0) < dailyTarget,
    queue_pending: queueCounts.queued || 0,
    queue_failed: queueCounts.failed || 0,
    publishability,
    rank_alerts_open: alertRes.count || 0,
    indexing_success_rate: +indexRate.toFixed(1),
    search_standard: {
      publishing_source: 'yeosonam.com /blog',
      primary_market: 'naver',
      secondary_market: 'google',
      naver: {
        role: 'Korean SERP fit, longtail intent, IndexNow notification',
        indexnow_success_rate: naverIndexNowSuccessRate,
      },
      google: {
        role: 'GSC metrics, sitemap submission, URL inspection, canonical/indexability health',
        sitemap_success_rate: googleSitemapSuccessRate,
        actual_indexed_rate: googleIndexedRate,
        inspected_indexed: googleIndexed,
        inspected_not_indexed: googleNotIndexed,
        direct_indexing_api_policy: 'skipped for normal blog posts; use sitemap/GSC unless explicitly enabled',
      },
      global_indexnow_success_rate: globalIndexNowSuccessRate,
      visibility_snapshots_24h: visibilityRes.count || 0,
      rank_history_rows_30d: rankRes.count || 0,
      health_issues: searchHealthIssues,
    },
    avg_readability: avgReadability,
    destination_distribution: destDist,
    publisher_cron: {
      last_status: publisherCron?.last_status ?? null,
      last_run_at: publisherCron?.last_run_at ?? null,
      last_error_count: publisherCron?.last_error_count ?? null,
      last_summary: publisherCron?.last_summary ?? null,
      ran_today: publisherRanToday,
      post_summary_publisher_run: postSummaryPublisherRun,
      post_summary_note: postSummaryPublisherRun
        ? 'Publisher ran after the daily summary slot; published count is recalculated in this response.'
        : null,
    },
    failure_breakdown: {
      publisher: failureBreakdown,
      candidate_shortage: summaryResults === summaryFallback ? null : Math.max(0, dailyTarget * 2 - publishability.publishable_candidate_count),
    },
    next_action: publishability.next_action !== 'publish_ready'
      ? `Resolve publishability issue: ${publishability.next_action}.`
      : Object.keys(failureBreakdown).length > 0
      ? 'Fix the largest publisher failure bucket before requeueing duplicate topics.'
      : 'Keep scheduler and publisher running; refill queue if pending candidates drop below target.',
  };
  const opsWatcher = buildBlogOpsWatcherReport(summary, errors);
  (summary as any).ops_watcher = opsWatcher;

  if (summary.under_daily_target) {
    const message = `블로그 일일 발행 SLA 미달: ${summary.date} KST published=${summary.published}, min=${dailyTarget}`;
    errors.push(message);
    await insertDedupedBlogAlert({
      severity: summary.published === 0 ? 'high' : 'medium',
      title: '블로그 일일 발행 SLA 미달',
      message,
      refType: 'blog_daily_summary',
      refId: summary.date,
      meta: {
        published: summary.published,
        min_daily_target: dailyTarget,
        queue_pending: summary.queue_pending,
        queue_failed: summary.queue_failed,
        recommendation: '품질 게이트 실패 또는 큐 부족 원인을 확인하고 대체 토픽을 큐잉하세요.',
      },
    });
  }

  if (searchHealthIssues.length > 0) {
    const message = `블로그 검색 제출 상태 점검 필요: ${searchHealthIssues.join(', ')}`;
    errors.push(message);
    await insertDedupedBlogAlert({
      severity: 'medium',
      title: '블로그 검색 제출 상태 점검 필요',
      message,
      refType: 'blog_search_indexing',
      refId: summary.date,
      meta: {
        search_standard: summary.search_standard,
        recommendation: '네이버는 IndexNow/Search Advisor, 구글은 GSC sitemap과 URL Inspection 권한을 우선 확인하세요.',
      },
    });
  }

  for (const issue of opsWatcher.issues) {
    await insertDedupedBlogAlert({
      severity: issue.severity,
      title: `[Blog Ops Watcher] ${issue.title}`,
      message: `${issue.detail}\nNext: ${issue.recommendation}`,
      refType: `blog_ops_watcher:${issue.code}`,
      refId: summary.date,
      meta: {
        issue,
        watcher_level: opsWatcher.level,
        report_date: summary.date,
        published: summary.published,
        min_daily_target: summary.min_daily_target,
        queue_pending: summary.queue_pending,
        queue_failed: summary.queue_failed,
        publisher_cron: summary.publisher_cron,
        search_health_issues: summary.search_standard.health_issues,
      },
      dedupeOpenByRefType: true,
    });
  }

  // 2) 저성과 글 재생성 트리거 (정책 ON 시)
  let regenInfo: { count: number } | null = null;
  if (policy?.auto_regenerate_underperformers) {
    try {
      regenInfo = await withTimeout(regenerateUnderperformers(), 12_000, { count: 0 });
    } catch (e) {
      errors.push(`regen 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3) Webhook push (Slack/Discord 호환 JSON)
  let webhookInfo: { sent: boolean; status?: number } | null = null;
  if (policy?.daily_summary_webhook) {
    try {
      const text = `📊 *여소남 블로그 발행 요약 ${summary.date}*\n` +
        `• 발행: ${summary.published}편 (대기 ${summary.queue_pending} / 실패 ${summary.queue_failed})\n` +
        `• 색인 성공률: ${summary.indexing_success_rate}%\n` +
        `• 평균 가독성: ${summary.avg_readability ?? '-'}/100\n` +
        `• 순위 경보: ${summary.rank_alerts_open}건` +
        (regenInfo ? `\n• 저성과 재생성: ${regenInfo.count}건 큐잉` : '');

      const res = await fetch(policy.daily_summary_webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, summary }),
        signal: AbortSignal.timeout(8000),
      });
      webhookInfo = { sent: res.ok, status: res.status };
    } catch (e) {
      errors.push(`webhook 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    summary,
    regenerated: regenInfo,
    webhook: webhookInfo,
    errors,
    ranAt: new Date().toISOString(),
  };
}

/**
 * 7일 이상 발행 + GSC 클릭 0건 → 큐에 user_seed로 재생성
 */
async function regenerateUnderperformers(): Promise<{ count: number }> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // 후보: 7-14일 전 발행, 정보성 위주 (상품은 노출 사이클 다름)
  const { data: candidates } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, destination, angle_type, content_type, generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .is('product_id', null)
    .lte('published_at', sevenDaysAgo.toISOString())
    .gte('published_at', fourteenDaysAgo.toISOString())
    .limit(50);

  if (!candidates || candidates.length === 0) return { count: 0 };

  // GSC에서 7일 클릭 0건 필터
  const slugs = candidates.map((c: any) => c.slug);
  const { data: clickRows } = await supabaseAdmin
    .from('rank_history')
    .select('slug, clicks')
    .in('slug', slugs)
    .gte('date', sevenDaysAgo.toISOString().split('T')[0]);

  const clickMap = new Map<string, number>();
  for (const r of clickRows || []) {
    const row = r as { slug: string; clicks: number };
    clickMap.set(row.slug, (clickMap.get(row.slug) || 0) + (row.clicks || 0));
  }

  const underperformers = candidates.filter((c: any) => (clickMap.get(c.slug) || 0) === 0);
  if (underperformers.length === 0) return { count: 0 };

  // 14일 윈도 dedup — 같은 (destination, angle) 큐 이미 있으면 skip
  const { data: recentQueue } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('destination, angle_type')
    .gte('created_at', fourteenDaysAgo.toISOString());
  const recentKeys = new Set(((recentQueue || []) as unknown as Array<Record<string, unknown>>).map(r => `${r.destination}::${r.angle_type}`));

  const fresh = underperformers.filter((c: any) =>
    !recentKeys.has(`${c.destination}::${c.angle_type}`)
  ).slice(0, 5);  // 일일 5건 상한

  if (fresh.length === 0) return { count: 0 };

  const rows = fresh.map((c: any) => ({
    topic: c.seo_title || '(제목 없음)',
    source: 'user_seed',
    priority: 85,
    destination: c.destination,
    angle_type: c.angle_type,
    category: 'travel_tips',
    meta: {
      regenerated_from: c.id,
      regenerated_reason: '7일 GSC 클릭 0',
      original_slug: c.slug,
      original_title: c.seo_title,
    },
  }));

  const { data: inserted } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id');

  return { count: inserted?.length ?? 0 };
}

export const GET = withCronLogging('blog-daily-summary', runDailySummary);
