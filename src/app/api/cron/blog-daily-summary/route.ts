import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';
import {
  countPublishableQueueCandidates,
  loadQueueDemandSignalMapV3,
  MIN_PUBLISHABLE_BUFFER_DAYS,
  normalizeDailyPostTarget,
} from '@/lib/blog-scheduler';
import { getClosedKstDailySummaryRange } from '@/lib/blog-daily-summary-window';
import { summarizeBlogQueueOperationalHealth } from '@/lib/blog-queue-operational-health';
import { buildBlogEditorialBacklogWorkReport } from '@/lib/blog-editorial-backlog-work';
import { summarizeBlogIndexingCoverage } from '@/lib/blog-indexing-coverage';
import { evaluateBlogPublishPreflight } from '@/lib/blog-publish-preflight';
import { buildBlogCanaryPreflight } from '@/lib/blog-canary-preflight';
import { evaluateBlogGeneratedQualityCanaryReport } from '@/lib/blog-canary-generated-quality';
import { buildProductGeneratedCanaryRows } from '@/lib/blog-product-generated-canary';
import { inspectBlogFleetPhraseDrift } from '@/lib/blog-fleet-phrase-drift';
import {
  buildPublishedBlogUpgradeQueueTopic,
  PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
} from '@/lib/blog-private-regeneration';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';

/**
 * 일일 발행 요약 + 저성과 글 자동 재생성 트리거.
 * Runs after the final daily blog-publication-controller slot, so the report covers today's
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

function isLocalhostIndexingReport(report: any): boolean {
  const text = [
    report?.url,
    report?.google_error,
    report?.indexnow_error,
  ].filter(Boolean).join(' ');
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|sc-domain:localhost/i.test(text);
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

  if (summary.under_daily_target) {
    issues.push({
      code: 'daily_publish_sla_miss',
      severity: summary.published === 0 ? 'critical' : 'high',
      title: 'Daily blog publish target missed',
      detail: `Published ${summary.published}/${summary.min_daily_target} posts for ${summary.date} KST.`,
      recommendation: 'Inspect blog-generate, blog-publication-controller, approved runs, and recent quality-gate failures before requeueing.',
    });
  }

  const remainingDailyPosts = Math.max(0, Number(summary.min_daily_target ?? 0) - Number(summary.published ?? 0));
  const publishableCandidateCount = Number(summary.publishability?.publishable_candidate_count ?? 0);
  if (summary.under_daily_target && remainingDailyPosts > 0 && publishableCandidateCount >= remainingDailyPosts) {
    issues.push({
      code: 'catchup_publishable_candidates_available',
      severity: 'critical',
      title: 'Blog target missed while publishable candidates were available',
      detail: `${publishableCandidateCount} publishable candidate(s) were available for ${remainingDailyPosts} remaining slot(s).`,
      recommendation: 'Treat this as publication recovery failure: inspect approved_for_slot inventory, then run blog-publication-controller until remainingAfterRun is 0 or a concrete blocker appears.',
    });
  }

  if (summary.publisher_cron && summary.publisher_cron.ran_today === false && summary.under_daily_target) {
    issues.push({
      code: 'publisher_cron_not_observed',
      severity: 'critical',
      title: 'Blog publisher cron did not run today',
      detail: `No blog-publication-controller cron run was recorded for ${summary.date} KST. Last run: ${summary.publisher_cron.last_run_at ?? 'unknown'}.`,
      recommendation: 'Check Vercel Cron delivery, Deployment Protection bypass, and CRON_SECRET before manually forcing publication.',
    });
  }

  if ((summary.queue_actionable_failed ?? summary.queue_failed ?? 0) > 0) {
    issues.push({
      code: 'queue_failures_present',
      severity: 'high',
      title: 'Blog queue has failed rows',
      detail: `${summary.queue_actionable_failed ?? summary.queue_failed} retryable failed queue row(s) need action; ${summary.queue_failed_total ?? summary.queue_failed ?? 0} total failed rows exist.`,
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

  if (summary.publish_preflight?.status === 'block') {
    issues.push({
      code: 'publish_preflight_blocked',
      severity: 'high',
      title: 'Blog publish preflight is blocked',
      detail: summary.publish_preflight.blockers?.[0]?.detail ?? 'The preflight found a blocking publish safety issue.',
      recommendation: summary.publish_preflight.next_action ?? 'Resolve preflight blockers before expanding automatic publishing.',
    });
  }

  if (summary.canary_preflight?.status === 'block') {
    issues.push({
      code: 'canary_candidates_unavailable',
      severity: 'high',
      title: 'Blog canary candidates are unavailable',
      detail: `Canary-ready candidates ${summary.canary_preflight.ready_count}/${summary.canary_preflight.requested}.`,
      recommendation: summary.canary_preflight.next_action ?? 'Refill safe canary candidates before expanding automatic publishing.',
    });
  }

  if (summary.generated_canary_quality?.status === 'block') {
    const fleetPhraseDrift = summary.generated_canary_quality.fleet_phrase_drift;
    const detail = summary.generated_canary_quality.fail_count > 0
      ? `${summary.generated_canary_quality.fail_count}/${summary.generated_canary_quality.checked_count} generated sample(s) failed engine/customer/render checks.`
      : fleetPhraseDrift?.status === 'block'
        ? fleetPhraseDrift.summary
        : 'Generated blog canary quality failed.';
    issues.push({
      code: 'generated_canary_quality_failed',
      severity: 'high',
      title: 'Generated blog canary quality failed',
      detail,
      recommendation: summary.generated_canary_quality.next_action ?? 'Repair generated canary failures before expanding automatic publishing.',
    });
  } else if (summary.generated_canary_quality?.status === 'warn') {
    issues.push({
      code: 'generated_canary_quality_incomplete',
      severity: 'warning',
      title: 'Generated blog canary proof is incomplete',
      detail: summary.generated_canary_quality.next_action ?? 'Generated canary proof needs more body samples.',
      recommendation: 'Publish or dry-run mixed info/product samples before calling the full blog engine 100점.',
    });
  }

  if (summary.fleet_phrase_drift?.status && summary.fleet_phrase_drift.status !== 'pass') {
    issues.push({
      code: 'fleet_phrase_drift',
      severity: summary.fleet_phrase_drift.status === 'block' ? 'high' : 'warning',
      title: 'Blog fleet phrase drift detected',
      detail: summary.fleet_phrase_drift.summary ?? 'Recent published posts share repeated openings, heading orders, or CTA wording.',
      recommendation: summary.fleet_phrase_drift.next_action ?? 'Rotate reader scenarios, openings, section order, and CTA wording before expanding automatic publishing.',
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
  const autopublishPolicy = readBlogAutopublishPolicyV3();
  const dailyTarget = normalizeDailyPostTarget(policy?.posts_per_day ?? process.env.BLOG_DAILY_PUBLISH_TARGET);
  const publicDailyTarget = policy?.enabled === false || autopublishPolicy.mode === 'draft_only'
    ? 0
    : dailyTarget;
  const generatedCanaryRequested = Math.min(5, Math.max(3, dailyTarget));

  // Report the latest closed KST publishing day. If the route is delayed past
  // midnight or called manually before 22:45 KST, it must not evaluate the new
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
    { data: [], count: 0 },
  ] as any;
  const summaryResults = await withTimeout(Promise.all([
    supabaseAdmin.from('content_creatives').select('id, slug, seo_title, content_type, product_id, destination, blog_html, readability_score, seo_score, quality_gate, generation_meta', { count: 'exact' })
      .eq('channel', 'naver_blog').eq('status', 'published')
      .gte('published_at', reportDay.start.toISOString()).lt('published_at', reportDay.end.toISOString()),
    supabaseAdmin.from('blog_topic_queue').select('id, status, product_id, content_creative_id, destination, angle_type, topic, source, priority, primary_keyword, category, attempts, last_error, created_at, updated_at, target_publish_at, monthly_search_volume, trend_score, meta', { count: 'exact' })
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
      .eq('cron_name', 'blog-publication-controller')
      .limit(1),
    supabaseAdmin.from('content_creatives').select('id, destination, angle_type, slug, seo_title, blog_html, product_id, generation_meta')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('published_at', { ascending: false })
      .limit(300),
    supabaseAdmin.from('blog_indexing_jobs').select('content_creative_id, slug, url, status')
      .order('updated_at', { ascending: false })
      .limit(1000),
  ]), 18_000, summaryFallback);
  if (summaryResults === summaryFallback) {
    errors.push('daily_summary_source_queries_timed_out');
  }
  const [pubRes, queueRes, alertRes, indexRes, visibilityRes, rankRes, publisherCronRes, recentPublishedRes, indexingJobsRes] = summaryResults;

  const published = pubRes.data || [];
  const indexingOutboxCoverage = summarizeBlogIndexingCoverage({
    posts: published.map((post: any) => ({
      id: post.id,
      slug: post.slug,
    })),
    jobs: indexingJobsRes.data || [],
  });
  const indexReports = (indexRes.data || []).filter((report: any) => !isLocalhostIndexingReport(report));
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
  if (indexingOutboxCoverage.missing_count > 0) {
    searchHealthIssues.push(`indexing_outbox_missing:${indexingOutboxCoverage.missing_count}`);
  }

  const queueCounts = (queueRes.data || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const queueOperationalHealth = summarizeBlogQueueOperationalHealth(queueRes.data || []);
  const editorialBacklogWork = buildBlogEditorialBacklogWorkReport({
    rows: queueRes.data || [],
    limit: 12,
  });
  const publishableQueueRows = (queueRes.data || [])
    .filter((row: any) => row.status === 'queued' || row.status === 'generating');
  const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(publishableQueueRows);
  const publishabilityStats = countPublishableQueueCandidates({
    activeQueue: publishableQueueRows,
    recentPublished: recentPublishedRes.data || [],
    demandSignalsByQueueId,
  });
  const publishability = {
    queued_total: (queueRes.data || []).filter((row: any) => row.status === 'queued' || row.status === 'generating').length,
    publishable_candidate_count: publishabilityStats.publishableCount,
    duplicate_candidate_count: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidence_insufficient_count: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing,
    demand_missing_count: publishabilityStats.demandMissing,
    candidate_contract_blocked_count: publishabilityStats.candidateContractBlocked,
    candidate_shortage: publishabilityStats.publishableCount < dailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS,
    next_action: publishabilityStats.demandMissing > 0
      ? 'collect_demand'
      : publishabilityStats.evidenceInsufficient + publishabilityStats.productOpenContractBlocked > 0
        ? 'collect_evidence'
      : publishabilityStats.candidateContractBlocked > 0
        ? 'repair_candidate_contract'
        : publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued > 0
          ? 'quarantine_duplicates'
          : publishabilityStats.publishableCount < dailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS
            ? 'refill_candidates'
            : 'publish_ready',
  };
  const publishPreflight = evaluateBlogPublishPreflight({
    dailyTarget,
    publishedToday: pubRes.count || 0,
    publishableCandidateCount: publishabilityStats.publishableCount,
    duplicateCandidateCount: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidenceInsufficientCount: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing,
    candidateShortage: publishability.candidate_shortage,
    actionableFailedCount: queueOperationalHealth.actionable_failed_count,
    staleGeneratingCount: queueOperationalHealth.stale_generating_count,
    manualReviewCount: queueOperationalHealth.manual_review_count,
    overdueQueuedCount: queueOperationalHealth.overdue_queued_count,
    indexingOutboxMissingCount: indexingOutboxCoverage.missing_count,
    indexingOutboxCoverageRate: indexingOutboxCoverage.coverage_rate,
    recentPosts: published,
    bufferDays: MIN_PUBLISHABLE_BUFFER_DAYS,
  });
  const canaryPreflight = buildBlogCanaryPreflight({
    activeQueue: (queueRes.data || []).filter((row: any) => row.status === 'queued' || row.status === 'generating'),
    recentPublished: recentPublishedRes.data || [],
    requested: 3,
  });
  const productCanaryIds = Array.from(new Set(
    (queueRes.data || [])
      .filter((row: any) => (row.status === 'queued' || row.status === 'generating') && row.product_id)
      .map((row: any) => String(row.product_id)),
  )).slice(0, 12);
  const productCanaryProducts = productCanaryIds.length > 0
    ? await withTimeout(
      supabaseAdmin.from('travel_packages').select('*').in('id', productCanaryIds),
      8_000,
      { data: [], count: 0 } as any,
    )
    : { data: [] };
  const productGeneratedCanaryRows = buildProductGeneratedCanaryRows({
    queueRows: (queueRes.data || []).filter((row: any) => row.status === 'queued' || row.status === 'generating'),
    products: productCanaryProducts.data || [],
    limit: Math.min(3, Math.max(2, generatedCanaryRequested - 2)),
  });
  const generatedCanaryQuality = await evaluateBlogGeneratedQualityCanaryReport({
    posts: [...(published as any[]), ...productGeneratedCanaryRows],
    requested: generatedCanaryRequested,
    writerMixRequired: productGeneratedCanaryRows.length > 0,
  });
  const fleetPhraseDrift = inspectBlogFleetPhraseDrift(
    (recentPublishedRes.data || []).slice(0, 100).map((row: any) => ({
      id: row.id,
      slug: row.slug,
      title: row.seo_title,
      blog_html: row.blog_html,
      writer_type: row.generation_meta?.writer ?? row.generation_meta?.writer_type ?? null,
    })),
  );

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
    min_daily_target: publicDailyTarget,
    configured_generation_target: dailyTarget,
    under_daily_target: (pubRes.count || 0) < publicDailyTarget,
    autopublish: {
      requested_mode: autopublishPolicy.requestedMode,
      effective_mode: autopublishPolicy.mode,
      daily_publish_cap: autopublishPolicy.dailyPublishCap,
      public_publication_enabled: publicDailyTarget > 0,
    },
    queue_pending: queueCounts.queued || 0,
    queue_failed: queueOperationalHealth.actionable_failed_count,
    queue_failed_total: queueCounts.failed || 0,
    queue_actionable_failed: queueOperationalHealth.actionable_failed_count,
    queue_manual_review: queueOperationalHealth.manual_review_count,
    queue_stale_generating: queueOperationalHealth.stale_generating_count,
    queue_operational_health: queueOperationalHealth,
    editorial_backlog_work: editorialBacklogWork,
    publishability,
    publish_preflight: publishPreflight,
    canary_preflight: canaryPreflight,
    generated_canary_quality: generatedCanaryQuality,
    fleet_phrase_drift: fleetPhraseDrift,
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
      indexing_outbox_coverage: indexingOutboxCoverage,
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
      candidate_shortage: summaryResults === summaryFallback ? null : Math.max(0, dailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS - publishability.publishable_candidate_count),
    },
    next_action: publishability.next_action !== 'publish_ready'
      ? `Resolve publishability issue: ${publishability.next_action}.`
      : Object.keys(failureBreakdown).length > 0
      ? 'Fix the largest publisher failure bucket before requeueing duplicate topics.'
      : editorialBacklogWork.total > 0
      ? 'Review editorial backlog samples before regenerating more failed topics.'
      : 'Keep scheduler and publisher running; refill queue if pending candidates drop below target.',
  };
  const opsWatcher = buildBlogOpsWatcherReport(summary, errors);
  (summary as any).ops_watcher = opsWatcher;

  if (summary.under_daily_target) {
    const message = `블로그 일일 발행 SLA 미달: ${summary.date} KST published=${summary.published}, min=${publicDailyTarget}`;
    errors.push(message);
    await insertDedupedBlogAlert({
      severity: summary.published === 0 ? 'high' : 'medium',
      title: '블로그 일일 발행 SLA 미달',
      message,
      refType: 'blog_daily_summary',
      refId: summary.date,
      meta: {
        published: summary.published,
        min_daily_target: publicDailyTarget,
        queue_pending: summary.queue_pending,
        queue_failed: summary.queue_failed,
        queue_failed_total: summary.queue_failed_total,
        queue_operational_health: summary.queue_operational_health,
        recommendation: '품질 게이트 실패 또는 큐 부족 원인을 확인하고 대체 토픽을 큐잉하세요.',
      },
    });
  }

  if (searchHealthIssues.length > 0) {
    const message = `블로그 검색 제출 상태 점검 필요: ${searchHealthIssues.join(', ')}`;
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
        queue_failed_total: summary.queue_failed_total,
        queue_operational_health: summary.queue_operational_health,
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
        `• 발행: ${summary.published}편 (대기 ${summary.queue_pending} / 조치필요 실패 ${summary.queue_failed} / 총 실패 ${summary.queue_failed_total})\n` +
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

  // 14일 윈도 dedup — 동일 글의 업그레이드 큐만 중복 억제한다.
  const { data: recentQueue } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('content_creative_id')
    .gte('created_at', fourteenDaysAgo.toISOString());
  const recentCreativeIds = new Set(
    ((recentQueue || []) as Array<{ content_creative_id?: string | null }>)
      .map(row => row.content_creative_id)
      .filter((id): id is string => Boolean(id)),
  );

  const fresh = underperformers
    .filter((c: any) => !recentCreativeIds.has(c.id))
    .slice(0, 5);  // 일일 5건 상한

  if (fresh.length === 0) return { count: 0 };

  const rows = fresh.map((c: any) => {
    const queueTopic = buildPublishedBlogUpgradeQueueTopic(c);
    return {
      topic: queueTopic,
      source: 'user_seed',
      priority: 85,
      primary_keyword: queueTopic,
      destination: c.destination,
      angle_type: c.angle_type,
      category: c.category || 'travel_tips',
      content_creative_id: c.id,
      meta: {
        regenerated_from: c.id,
        regenerated_reason: '7일 GSC 클릭 0',
        expected_slug: c.slug,
        original_slug: c.slug,
        original_title: c.seo_title,
        private_regeneration: {
          mode: PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE,
          atomic_publish_replace: true,
        },
      },
    };
  });

  const { data: inserted } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id');

  return { count: inserted?.length ?? 0 };
}

export const GET = withCronLogging('blog-daily-summary', runDailySummary);
