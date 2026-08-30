import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  countPublishableQueueCandidates,
  loadQueueDemandSignalMapV3,
  MIN_PUBLISHABLE_BUFFER_DAYS,
} from '../src/lib/blog-scheduler';
import { getClosedKstDailySummaryRange } from '../src/lib/blog-daily-summary-window';
import { summarizeBlogQueueOperationalHealth } from '../src/lib/blog-queue-operational-health';
import { buildBlogProductEvidenceWorkReport } from '../src/lib/blog-product-evidence-work';
import { buildBlogEditorialBacklogWorkReport } from '../src/lib/blog-editorial-backlog-work';
import { buildBlogDestinationlessInfoWorkReport } from '../src/lib/blog-destinationless-info';
import { summarizeBlogIndexingCoverage } from '../src/lib/blog-indexing-coverage';
import { evaluateBlogPublishPreflight } from '../src/lib/blog-publish-preflight';
import { buildBlogCanaryPreflight } from '../src/lib/blog-canary-preflight';
import { evaluateBlogGeneratedQualityCanaryReport } from '../src/lib/blog-canary-generated-quality';
import { buildProductGeneratedCanaryRows } from '../src/lib/blog-product-generated-canary';
import { evaluateCurrentDayPublisherHealth } from '../src/lib/blog-current-day-publisher-health';
import { classifyBlogAutopublishDiagnosisBuckets } from '../src/lib/blog-autopublish-diagnosis';
import { inspectBlogFleetPhraseDrift } from '../src/lib/blog-fleet-phrase-drift';
import {
  hasVerifiedBlogDemandSignal,
  readBlogAutopublishPolicyV3,
} from '../src/lib/blog-autopublish-policy-v3';
import { PUBLIC_BLOG_READ_SOURCE } from '../src/lib/blog-public-eligibility';

dotenv.config({ path: '.env.local' });
dotenv.config();

type BucketCode =
  | 'daily_publish_sla_miss'
  | 'publisher_cron_not_observed'
  | 'publisher_timeout'
  | 'duplicate_candidate_burn'
  | 'product_open_contract_blocked'
  | 'editorial_backlog_work'
  | 'destinationless_info_work'
  | 'published_info_destination_work'
  | 'table_integrity_fail'
  | 'candidate_shortage'
  | 'audit_contract_mismatch'
  | 'indexing_queue_error'
  | 'indexing_outbox_missing'
  | 'publish_preflight_blocked'
  | 'canary_candidates_unavailable'
  | 'generated_canary_quality_incomplete'
  | 'generated_canary_quality_failed'
  | 'fleet_phrase_drift'
  | 'demand_repository_missing'
  | 'current_day_publisher_failure';

type Bucket = {
  code: BucketCode;
  severity: 'info' | 'warning' | 'high' | 'critical';
  detail: string;
  evidence?: unknown;
};

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const dateArg = args.find((arg) => arg.startsWith('--date='))?.split('=')[1];
const limitArg = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 20);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(limitArg, 100) : 20;
const recentPublishedLimit = Math.max(limit, 100);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

function kstDayKey(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function kstDayRange(dayKey: string): { dayKey: string; start: Date; end: Date } {
  const start = new Date(`${dayKey}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { dayKey, start, end };
}

function resolveReportDay(): {
  dayKey: string;
  start: Date;
  end: Date;
  closed: boolean;
  usedPreviousDayForPreCloseRun: boolean;
  closeMinuteKst: number | null;
} {
  if (dateArg) {
    return {
      ...kstDayRange(dateArg),
      closed: true,
      usedPreviousDayForPreCloseRun: false,
      closeMinuteKst: null,
    };
  }

  const closedDay = getClosedKstDailySummaryRange();
  return {
    ...closedDay,
    usedPreviousDayForPreCloseRun: closedDay.usedPreviousDay,
  };
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function summaryObject(row: any): Record<string, any> {
  return row?.summary && typeof row.summary === 'object' ? row.summary : {};
}

function lastSummaryObject(row: any): Record<string, any> {
  return row?.last_summary && typeof row.last_summary === 'object' ? row.last_summary : {};
}

function failureCount(summary: Record<string, any>, key: string): number {
  const breakdown = summary.failure_breakdown;
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return numberFrom((breakdown as Record<string, unknown>)[key]);
}

function containsText(value: unknown, pattern: RegExp): boolean {
  return JSON.stringify(value ?? '').match(pattern) !== null;
}

function startedAtMs(row: any): number {
  const parsed = new Date(row?.started_at ?? '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecoveredPublisherRun(row: any): boolean {
  const summary = summaryObject(row);
  const published = numberFrom(summary.published) + numberFrom(summary.published_count);
  const remaining = summary.dailyQuota && typeof summary.dailyQuota === 'object'
    ? numberFrom(summary.dailyQuota.remaining)
    : null;

  return (
    row?.status === 'success' &&
    (
      published > 0 ||
      remaining === 0 ||
      summary.reason === 'daily_publish_quota_reached'
    )
  );
}

function publishedFromDailySummary(cronHealth: Record<string, any>, dayKey: string): number | null {
  const summaryRow = lastSummaryObject(cronHealth['blog-daily-summary']);
  const summary = summaryRow.summary && typeof summaryRow.summary === 'object'
    ? summaryRow.summary as Record<string, unknown>
    : null;
  if (!summary || summary.date !== dayKey) return null;
  return numberOrNull(summary.published);
}

function publisherQuotaPublishedFromSummary(summary: Record<string, any>, dayKey: string): number | null {
  const dailyQuota = summary.dailyQuota && typeof summary.dailyQuota === 'object'
    ? summary.dailyQuota as Record<string, unknown>
    : null;
  if (!dailyQuota || dailyQuota.day !== dayKey) return null;

  const alreadyPublished = numberOrNull(dailyQuota.alreadyPublished);
  if (alreadyPublished !== null) return alreadyPublished;

  const alreadyBefore = numberOrNull(dailyQuota.alreadyPublishedBeforeRun);
  const published = numberOrNull(summary.published);
  if (alreadyBefore !== null && published !== null) return alreadyBefore + published;

  const target = numberOrNull(dailyQuota.target);
  const remaining = numberOrNull(dailyQuota.remaining);
  if (target !== null && remaining === 0) return target;

  return null;
}

function reconcileSelectedDayPublished(input: {
  rawPublished: number;
  dailySummaryPublished: number | null;
  publisherQuotaPublished: number | null;
}): { published: number; source: string; evidence: Record<string, number | null> } {
  return {
    published: input.rawPublished,
    source: 'public_eligibility_view',
    evidence: {
      raw: input.rawPublished,
      daily_summary: input.dailySummaryPublished,
      publisher_daily_quota: input.publisherQuotaPublished,
    },
  };
}

async function countByStatus(table: string, statuses: string[]) {
  const { data, error } = await supabase
    .from(table)
    .select('status')
    .in('status', statuses);
  if (error) throw error;
  return (data ?? []).reduce((acc: Record<string, number>, row: any) => {
    const status = String(row.status ?? 'unknown');
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const day = resolveReportDay();
  const currentDay = kstDayRange(kstDayKey());
  const yesterday = kstDayRange(kstDayKey(new Date(day.start.getTime() - 1)));

  const [
    publishedTodayRes,
    publishedYesterdayRes,
    publishedCurrentDayRes,
    recentPublishedRes,
    queueCounts,
    indexingCounts,
    indexingProblemRes,
    indexingCoverageJobsRes,
    activeQueueRes,
    queueOperationalRes,
    cronHealthRes,
    publisherLogsRes,
    policyRes,
  ] = await Promise.all([
    supabase
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('id', { count: 'exact', head: true })
      .gte('published_at', day.start.toISOString())
      .lt('published_at', day.end.toISOString()),
    supabase
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('id', { count: 'exact', head: true })
      .gte('published_at', yesterday.start.toISOString())
      .lt('published_at', yesterday.end.toISOString()),
    supabase
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('id', { count: 'exact', head: true })
      .gte('published_at', currentDay.start.toISOString())
      .lt('published_at', currentDay.end.toISOString()),
    supabase
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('id, slug, seo_title, category, content_type, product_id, destination, blog_html, published_at, generation_meta, quality_gate, seo_score, readability_score')
      .order('published_at', { ascending: false })
      .limit(recentPublishedLimit),
    countByStatus('blog_topic_queue', ['queued', 'generating', 'failed', 'skipped', 'deferred']),
    countByStatus('blog_indexing_jobs', ['pending', 'retry', 'processing', 'succeeded', 'failed']),
    supabase
      .from('blog_indexing_jobs')
      .select('id, slug, status, attempts, max_attempts, next_attempt_at, last_error, updated_at, succeeded_at')
      .in('status', ['pending', 'retry', 'processing', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabase
      .from('blog_indexing_jobs')
      .select('content_creative_id, slug, url, status')
      .order('updated_at', { ascending: false })
      .limit(1000),
    supabase
      .from('blog_topic_queue')
      .select('id, product_id, content_creative_id, destination, angle_type, topic, source, priority, created_at, updated_at, target_publish_at, primary_keyword, category, monthly_search_volume, trend_score, meta')
      .in('status', ['queued', 'generating'])
      .limit(500),
    supabase
      .from('blog_topic_queue')
      .select('id, status, product_id, destination, topic, source, attempts, last_error, created_at, updated_at, target_publish_at, monthly_search_volume, trend_score, meta')
      .in('status', ['queued', 'generating', 'failed'])
      .limit(1000),
    supabase
      .from('cron_health')
      .select('cron_name, last_status, last_run_at, last_error_count, last_elapsed_ms, last_summary')
      .in('cron_name', ['blog-scheduler', 'blog-publisher', 'blog-daily-summary', 'blog-indexing-worker']),
    supabase
      .from('cron_run_logs')
      .select('cron_name, status, started_at, finished_at, elapsed_ms, error_count, error_messages, summary')
      .eq('cron_name', 'blog-publisher')
      .gte('started_at', day.start.toISOString())
      .lt('started_at', day.end.toISOString())
      .order('started_at', { ascending: false })
      .limit(limit),
    supabase
      .from('publishing_policies')
      .select('scope, posts_per_day, per_destination_daily_cap, slot_times')
      .eq('scope', 'global')
      .limit(1),
  ]);

  for (const result of [
    publishedTodayRes,
    publishedYesterdayRes,
    publishedCurrentDayRes,
    recentPublishedRes,
    indexingProblemRes,
    indexingCoverageJobsRes,
    activeQueueRes,
    queueOperationalRes,
    cronHealthRes,
    publisherLogsRes,
    policyRes,
  ]) {
    if ('error' in result && result.error) throw result.error;
  }

  const policy = policyRes.data?.[0] ?? null;
  const dailyTarget = Math.min(
    numberFrom(policy?.posts_per_day) || 1,
    readBlogAutopublishPolicyV3().dailyPublishCap,
  );
  const generatedCanaryRequested = Math.min(5, Math.max(3, dailyTarget));
  const cronHealth = Object.fromEntries((cronHealthRes.data ?? []).map((row: any) => [row.cron_name, row]));
  const publisherHealth = cronHealth['blog-publisher'];
  const publisherLogs = publisherLogsRes.data ?? [];
  const activeQueue = activeQueueRes.data ?? [];
  const [demandSignalProbe, searchPerformanceProbe] = await Promise.all([
    supabase.from('blog_demand_signals').select('id').limit(1),
    supabase.from('blog_search_performance').select('id').limit(1),
  ]);
  const demandRepositoryErrors = [
    demandSignalProbe.error ? `blog_demand_signals:${demandSignalProbe.error.message}` : null,
    searchPerformanceProbe.error ? `blog_search_performance:${searchPerformanceProbe.error.message}` : null,
  ].filter((value): value is string => Boolean(value));
  const demandRepositoryReady = demandRepositoryErrors.length === 0;
  const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(activeQueue, supabase);
  const observedDemandMissingCount = activeQueue.filter((row: any) => (
    row.source !== 'pillar'
      && !hasVerifiedBlogDemandSignal(demandSignalsByQueueId.get(String(row.id)) ?? {})
  )).length;
  const publishabilityStats = countPublishableQueueCandidates({
    activeQueue: activeQueueRes.data ?? [],
    recentPublished: recentPublishedRes.data ?? [],
    demandSignalsByQueueId,
  });
  const indexingOutboxCoverage = summarizeBlogIndexingCoverage({
    posts: recentPublishedRes.data ?? [],
    jobs: indexingCoverageJobsRes.data ?? [],
    limit,
  });
  const queueOperationalHealth = summarizeBlogQueueOperationalHealth(queueOperationalRes.data ?? []);
  const productEvidenceProductIds = Array.from(new Set(
    (queueOperationalRes.data ?? [])
      .map((row: any) => typeof row.product_id === 'string' ? row.product_id : null)
      .filter((id: string | null): id is string => Boolean(id)),
  ));
  const productsById = new Map<string, any>();
  if (productEvidenceProductIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from('travel_packages')
      .select('*')
      .in('id', productEvidenceProductIds.slice(0, 200));
    if (productsError) throw productsError;
    for (const product of products ?? []) {
      productsById.set(String(product.id), product);
    }
  }
  const productEvidenceWork = buildBlogProductEvidenceWorkReport({
    rows: queueOperationalRes.data ?? [],
    productsById,
    limit,
  });
  const editorialBacklogWork = buildBlogEditorialBacklogWorkReport({
    rows: queueOperationalRes.data ?? [],
    limit,
  });
  const destinationlessInfoWork = buildBlogDestinationlessInfoWorkReport({
    rows: activeQueueRes.data ?? [],
    limit,
  });
  const publishedInfoDestinationWork = buildBlogDestinationlessInfoWorkReport({
    rows: (recentPublishedRes.data ?? []).map((row: any) => ({
      ...row,
      topic: row.seo_title ?? row.slug,
      source: 'content_creatives',
    })),
    limit,
  });
  const publishabilitySnapshot = {
    queued_total: (activeQueueRes.data ?? []).filter((row: any) => row.source !== 'pillar').length,
    publishable_candidate_count: publishabilityStats.publishableCount,
    duplicate_candidate_count: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidence_insufficient_count: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing,
    demand_missing_count: observedDemandMissingCount,
    destinationless_info_count: publishabilityStats.destinationlessInfoBlocked,
    candidate_contract_blocked_count: publishabilityStats.candidateContractBlocked,
    candidate_shortage: publishabilityStats.publishableCount < dailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS,
    next_action: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing > 0
      ? (observedDemandMissingCount > 0 ? 'collect_demand' : 'collect_evidence')
      : publishabilityStats.destinationlessInfoBlocked > 0
        ? 'repair_destinationless_info'
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
    publishedToday: publishedCurrentDayRes.count ?? 0,
    publishableCandidateCount: publishabilityStats.publishableCount,
    duplicateCandidateCount: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidenceInsufficientCount: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing,
    candidateShortage: publishabilitySnapshot.candidate_shortage,
    actionableFailedCount: queueOperationalHealth.actionable_failed_count,
    staleGeneratingCount: queueOperationalHealth.stale_generating_count,
    manualReviewCount: queueOperationalHealth.manual_review_count,
    overdueQueuedCount: queueOperationalHealth.overdue_queued_count,
    indexingOutboxMissingCount: indexingOutboxCoverage.missing_count,
    indexingOutboxCoverageRate: indexingOutboxCoverage.coverage_rate,
    recentPosts: recentPublishedRes.data ?? [],
    bufferDays: MIN_PUBLISHABLE_BUFFER_DAYS,
  });
  const canaryPreflight = buildBlogCanaryPreflight({
    activeQueue: activeQueueRes.data ?? [],
    recentPublished: recentPublishedRes.data ?? [],
    requested: 3,
  });
  const productGeneratedCanaryRows = buildProductGeneratedCanaryRows({
    queueRows: activeQueueRes.data ?? [],
    products: [...productsById.values()],
    limit: Math.min(3, Math.max(2, generatedCanaryRequested - 2)),
  });
  const generatedCanaryQuality = await evaluateBlogGeneratedQualityCanaryReport({
    posts: [...(recentPublishedRes.data ?? []), ...productGeneratedCanaryRows],
    requested: generatedCanaryRequested,
    writerMixRequired: productGeneratedCanaryRows.length > 0,
  });
  const fleetPhraseDrift = inspectBlogFleetPhraseDrift(
    (recentPublishedRes.data ?? []).slice(0, recentPublishedLimit).map((row: any) => ({
      id: row.id,
      slug: row.slug,
      title: row.seo_title,
      blog_html: row.blog_html,
      writer_type: row.generation_meta?.writer ?? null,
    })),
  );
  const latestPublisherLog = publisherLogs[0] ?? null;
  const latestPublisherSummary = summaryObject(latestPublisherLog);
  const healthPublisherSummary = lastSummaryObject(publisherHealth);
  const combinedPublisherSummary = Object.keys(latestPublisherSummary).length > 0
    ? latestPublisherSummary
    : healthPublisherSummary;
  const currentDayPublisherHealth = evaluateCurrentDayPublisherHealth({
    cronHealth: publisherHealth,
    currentDayPublishedCount: publishedCurrentDayRes.count ?? 0,
    dailyTarget,
  });

  const buckets: Bucket[] = [];
  if (!demandRepositoryReady) {
    buckets.push({
      code: 'demand_repository_missing',
      severity: 'critical',
      detail: 'V3 demand repositories are unavailable; automatic publication must remain fail-closed.',
      evidence: demandRepositoryErrors,
    });
  }
  const selectedDayRawPublished = publishedTodayRes.count ?? 0;
  const dailySummaryPublished = publishedFromDailySummary(cronHealth, day.dayKey);
  const publisherQuotaPublished = Math.max(
    ...[
      publisherQuotaPublishedFromSummary(latestPublisherSummary, day.dayKey),
      publisherQuotaPublishedFromSummary(healthPublisherSummary, day.dayKey),
      publisherQuotaPublishedFromSummary(combinedPublisherSummary, day.dayKey),
    ].filter((value): value is number => typeof value === 'number'),
    0,
  ) || null;
  const selectedDayPublishedEvidence = reconcileSelectedDayPublished({
    rawPublished: selectedDayRawPublished,
    dailySummaryPublished,
    publisherQuotaPublished,
  });
  const selectedDayPublished = selectedDayPublishedEvidence.published;
  const selectedDayUnderTarget = selectedDayPublished < dailyTarget;
  const publisherRanToday = publisherLogs.length > 0 || (
    publisherHealth?.last_run_at &&
    new Date(publisherHealth.last_run_at) >= day.start &&
    new Date(publisherHealth.last_run_at) < day.end
  );

  if (selectedDayUnderTarget) {
    buckets.push({
      code: 'daily_publish_sla_miss',
      severity: selectedDayPublished === 0 ? 'critical' : 'high',
      detail: `Selected KST day published ${selectedDayPublished}/${dailyTarget} posts.`,
      evidence: {
        report_day: day.dayKey,
        published: selectedDayPublished,
        daily_target: dailyTarget,
        reconciliation_source: selectedDayPublishedEvidence.source,
        reconciliation_evidence: selectedDayPublishedEvidence.evidence,
        report_period_closed: day.closed,
        used_previous_day_for_pre_close_run: day.usedPreviousDayForPreCloseRun,
        latest_publisher_failure_breakdown: combinedPublisherSummary.failure_breakdown ?? null,
      },
    });
  }

  if (!publisherRanToday && selectedDayUnderTarget) {
    buckets.push({
      code: 'publisher_cron_not_observed',
      severity: 'critical',
      detail: 'No blog-publisher run was observed inside the selected KST day.',
      evidence: { last_run_at: publisherHealth?.last_run_at ?? null },
    });
  }

  const timeoutRuns = publisherLogs.filter((row: any) =>
    numberFrom(row.elapsed_ms) >= 280_000 ||
    containsText(row.error_messages, /timeout|timed out|285000|285초/i) ||
    containsText(row.summary, /timeout|timed out|285000|285초/i)
  );
  const latestTimeoutStartedAt = timeoutRuns.reduce((max: number, row: any) => Math.max(max, startedAtMs(row)), 0);
  const timeoutRecovered = timeoutRuns.length > 0 &&
    !selectedDayUnderTarget &&
    publishPreflight.status === 'pass' &&
    currentDayPublisherHealth.status === 'healthy' &&
    publisherLogs.some((row: any) => startedAtMs(row) > latestTimeoutStartedAt && isRecoveredPublisherRun(row));
  if (timeoutRuns.length > 0 && !timeoutRecovered) {
    buckets.push({
      code: 'publisher_timeout',
      severity: 'high',
      detail: `${timeoutRuns.length} publisher run(s) look close to or past the timeout ceiling.`,
      evidence: timeoutRuns.map((row: any) => ({ started_at: row.started_at, elapsed_ms: row.elapsed_ms, status: row.status })),
    });
  }

  const duplicateFailures = failureCount(combinedPublisherSummary, 'duplicate');
  if (duplicateFailures > 0) {
    buckets.push({
      code: 'duplicate_candidate_burn',
      severity: 'high',
      detail: `${duplicateFailures} candidate(s) were consumed by duplicate checks in the latest publisher summary.`,
      evidence: combinedPublisherSummary.failure_breakdown,
    });
  }

  const productOpenContractFailures = publishabilityStats.productOpenContractBlocked;
  if (productOpenContractFailures > 0) {
    buckets.push({
      code: 'product_open_contract_blocked',
      severity: 'high',
      detail: 'Active product-backed candidate(s) are blocked by stale or missing customer-open contract evidence.',
      evidence: {
        failure_breakdown: combinedPublisherSummary.failure_breakdown ?? null,
        product_evidence_work: productEvidenceWork.samples.slice(0, 5),
        hint: 'Repair package customer mobile proof/evidence pack before requeueing product-backed blog rows.',
      },
    });
  }

  if (editorialBacklogWork.total > 0) {
    buckets.push({
      code: 'editorial_backlog_work',
      severity: 'warning',
      detail: `${editorialBacklogWork.total} quarantined editorial backlog row(s) need generator, prompt, or quality-contract repair before requeueing.`,
      evidence: {
        issue_counts: editorialBacklogWork.issue_counts,
        category_counts: editorialBacklogWork.category_counts,
        next_actions: editorialBacklogWork.next_actions,
        samples: editorialBacklogWork.samples.slice(0, 5),
      },
    });
  }

  if (destinationlessInfoWork.total > 0) {
    buckets.push({
      code: 'destinationless_info_work',
      severity: 'warning',
      detail: `${destinationlessInfoWork.total} destinationless info candidate(s) need explicit generic intent or a concrete destination before publishing.`,
      evidence: destinationlessInfoWork,
    });
  }
  if (publishedInfoDestinationWork.total > 0) {
    buckets.push({
      code: 'published_info_destination_work',
      severity: 'warning',
      detail: `${publishedInfoDestinationWork.total} recent published info post(s) need explicit generic intent, a real destination, or archival.`,
      evidence: publishedInfoDestinationWork,
    });
  }

  const tableFailures = failureCount(combinedPublisherSummary, 'table_integrity');
  if (
    queueOperationalHealth.actionable_failed_count > 0 &&
    (tableFailures > 0 || containsText(publisherLogs, /table_integrity|too_few_table_rows/i))
  ) {
    buckets.push({
      code: 'table_integrity_fail',
      severity: 'high',
      detail: `${tableFailures || 'Some'} retryable candidate(s) failed table integrity checks.`,
      evidence: combinedPublisherSummary.failure_breakdown ?? null,
    });
  }

  const queued = publishabilitySnapshot.publishable_candidate_count;
  if (queued < dailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS) {
    buckets.push({
      code: 'candidate_shortage',
      severity: queued === 0 ? 'critical' : 'warning',
      detail: `Only ${queued} publishable blog candidate(s) remain for a target of ${dailyTarget}/day and a ${MIN_PUBLISHABLE_BUFFER_DAYS}-day buffer.`,
      evidence: publishabilitySnapshot,
    });
  }

  const contractMismatches = (recentPublishedRes.data ?? []).filter((row: any) => {
    const meta = row.generation_meta && typeof row.generation_meta === 'object' ? row.generation_meta : {};
    const isProduct = Boolean(row.product_id) || row.content_type === 'package_intro';
    if (isProduct) return !meta.content_brief || !meta.prompt_version;
    return !meta.content_brief || containsText({ slug: row.slug, meta }, /family budget|transport cost|hotel area budget|weather packing|local mobility/i);
  });
  if (contractMismatches.length > 0) {
    buckets.push({
      code: 'audit_contract_mismatch',
      severity: 'warning',
      detail: `${contractMismatches.length} recent published post(s) do not match the current generation/audit contract.`,
      evidence: contractMismatches.map((row: any) => ({
        slug: row.slug,
        content_type: row.content_type,
        product_id: row.product_id,
        has_content_brief: Boolean(row.generation_meta?.content_brief),
        prompt_version: row.generation_meta?.prompt_version ?? null,
      })),
    });
  }

  const indexingProblems = indexingProblemRes.data ?? [];
  if (numberFrom(indexingCounts.failed) > 0 || indexingProblems.some((row: any) => row.status === 'failed')) {
    buckets.push({
      code: 'indexing_queue_error',
      severity: 'warning',
      detail: `${numberFrom(indexingCounts.failed)} indexing job(s) are failed; pending/retry jobs may also be delayed.`,
      evidence: indexingProblems.slice(0, 10),
    });
  }
  if (indexingOutboxCoverage.missing_count > 0) {
    buckets.push({
      code: 'indexing_outbox_missing',
      severity: 'high',
      detail: `${indexingOutboxCoverage.missing_count} recent published post(s) are not connected to a blog_indexing_jobs row.`,
      evidence: indexingOutboxCoverage,
    });
  }
  if (publishPreflight.status === 'block') {
    buckets.push({
      code: 'publish_preflight_blocked',
      severity: 'high',
      detail: publishPreflight.blockers[0]?.detail ?? 'Blog publish preflight has blocking issues.',
      evidence: publishPreflight,
    });
  }
  if (canaryPreflight.status === 'block') {
    buckets.push({
      code: 'canary_candidates_unavailable',
      severity: 'high',
      detail: `Only ${canaryPreflight.ready_count}/${canaryPreflight.requested} canary candidate(s) are ready.`,
      evidence: canaryPreflight,
    });
  }
  if (generatedCanaryQuality.status === 'block') {
    const fleetPhraseDrift = generatedCanaryQuality.fleet_phrase_drift;
    const detail = generatedCanaryQuality.fail_count > 0
      ? `${generatedCanaryQuality.fail_count}/${generatedCanaryQuality.checked_count} generated canary sample(s) failed engine/customer/render checks.`
      : fleetPhraseDrift.status === 'block'
        ? fleetPhraseDrift.summary
        : 'Generated canary quality failed.';
    buckets.push({
      code: 'generated_canary_quality_failed',
      severity: 'high',
      detail,
      evidence: generatedCanaryQuality,
    });
  } else if (generatedCanaryQuality.status === 'warn') {
    buckets.push({
      code: 'generated_canary_quality_incomplete',
      severity: 'warning',
      detail: generatedCanaryQuality.next_action,
      evidence: generatedCanaryQuality,
    });
  }
  if (fleetPhraseDrift.status !== 'pass') {
    buckets.push({
      code: 'fleet_phrase_drift',
      severity: fleetPhraseDrift.status === 'block' ? 'high' : 'warning',
      detail: fleetPhraseDrift.summary,
      evidence: fleetPhraseDrift,
    });
  }
  if (currentDayPublisherHealth.status === 'risk') {
    buckets.push({
      code: 'current_day_publisher_failure',
      severity: 'critical',
      detail: currentDayPublisherHealth.detail,
      evidence: currentDayPublisherHealth.evidence,
    });
  }

  const classifiedBuckets = classifyBlogAutopublishDiagnosisBuckets(buckets, {
    reportDay: day.dayKey,
    currentDay: currentDay.dayKey,
    currentDayPublished: publishedCurrentDayRes.count ?? 0,
    dailyTarget,
    currentDayPublisherHealthy: currentDayPublisherHealth.status === 'healthy',
    publishPreflightBlocked: publishPreflight.status === 'block' || publishPreflight.blockers.length > 0,
    candidateShortage: publishabilitySnapshot.candidate_shortage,
  });

  const report = {
    date: day.dayKey,
    timezone: 'Asia/Seoul',
    generated_at: new Date().toISOString(),
    report_period_closed: day.closed,
    used_previous_day_for_pre_close_run: day.usedPreviousDayForPreCloseRun,
    close_minute_kst: day.closeMinuteKst,
    published: {
      selected_day: selectedDayPublished,
      selected_day_raw: selectedDayRawPublished,
      selected_day_reconciliation_source: selectedDayPublishedEvidence.source,
      selected_day_reconciliation_evidence: selectedDayPublishedEvidence.evidence,
      previous_day: publishedYesterdayRes.count ?? 0,
      current_day: publishedCurrentDayRes.count ?? 0,
      current_day_key: currentDay.dayKey,
      today: publishedCurrentDayRes.count ?? 0,
      yesterday: publishedYesterdayRes.count ?? 0,
      daily_target: dailyTarget,
      under_target: selectedDayUnderTarget,
      closed_day: {
        key: day.dayKey,
        published: selectedDayPublished,
        raw_published: selectedDayRawPublished,
        target: dailyTarget,
        remaining: Math.max(0, dailyTarget - selectedDayPublished),
        under_target: selectedDayUnderTarget,
        reconciliation_source: selectedDayPublishedEvidence.source,
        selected_because: day.usedPreviousDayForPreCloseRun
          ? 'pre_close_previous_day'
          : 'closed_current_day',
      },
      current_day_status: {
        key: currentDay.dayKey,
        published: publishedCurrentDayRes.count ?? 0,
        target: dailyTarget,
        remaining: Math.max(0, dailyTarget - (publishedCurrentDayRes.count ?? 0)),
        quota_met: (publishedCurrentDayRes.count ?? 0) >= dailyTarget,
        publisher_health: currentDayPublisherHealth.status,
        operating_status: classifiedBuckets.operating_status,
      },
    },
    queue: queueCounts,
    queue_operational_health: queueOperationalHealth,
    product_evidence_work: productEvidenceWork,
    editorial_backlog_work: editorialBacklogWork,
    destinationless_info_work: destinationlessInfoWork,
    published_info_destination_work: publishedInfoDestinationWork,
    publishability: publishabilitySnapshot,
    demand_repository: {
      ready: demandRepositoryReady,
      errors: demandRepositoryErrors,
    },
    publish_preflight: publishPreflight,
    canary_preflight: canaryPreflight,
    generated_canary_quality: generatedCanaryQuality,
    fleet_phrase_drift: fleetPhraseDrift,
    current_day_publisher_health: currentDayPublisherHealth,
    indexing_outbox_coverage: indexingOutboxCoverage,
    indexing_jobs: indexingCounts,
    cron_health: cronHealth,
    latest_publisher_runs: publisherLogs,
    operating_status: classifiedBuckets.operating_status,
    active_buckets: classifiedBuckets.active_buckets,
    historical_buckets: classifiedBuckets.historical_buckets,
    buckets,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Blog autopublish diagnosis (${report.date} KST)`);
  console.log(`Closed day: ${selectedDayPublished}/${dailyTarget} (${day.dayKey}, under target: ${selectedDayUnderTarget ? 'yes' : 'no'})`);
  console.log(`Current day: ${report.published.current_day}/${dailyTarget} (${currentDay.dayKey}, quota met: ${report.published.current_day_status.quota_met ? 'yes' : 'no'})`);
  console.log(`Queue: ${JSON.stringify(queueCounts)}`);
  console.log(`Publish preflight: ${publishPreflight.status} (${publishPreflight.score}/100)`);
  console.log(`Canary preflight: ${canaryPreflight.status} (${canaryPreflight.ready_count}/${canaryPreflight.requested})`);
  console.log(`Generated canary quality: ${generatedCanaryQuality.status} (${generatedCanaryQuality.pass_count}/${generatedCanaryQuality.checked_count})`);
  console.log(`Fleet phrase drift: ${fleetPhraseDrift.status} (${fleetPhraseDrift.checked_count} checked, ${fleetPhraseDrift.issue_count} issues)`);
  console.log(`Current-day publisher: ${currentDayPublisherHealth.status}`);
  console.log(`Indexing jobs: ${JSON.stringify(indexingCounts)}`);
  console.log(`Indexing outbox coverage: ${indexingOutboxCoverage.coverage_rate ?? '-'}% (${indexingOutboxCoverage.missing_count} missing)`);
  console.log(`Operating status: ${classifiedBuckets.operating_status} (active ${classifiedBuckets.active_buckets.length}, historical ${classifiedBuckets.historical_buckets.length})`);
  console.log('Active buckets:');
  if (classifiedBuckets.active_buckets.length === 0) {
    console.log('- none');
  }
  for (const bucket of classifiedBuckets.active_buckets) {
    console.log(`- [${bucket.severity}] ${bucket.code}: ${bucket.detail}`);
  }
  if (classifiedBuckets.historical_buckets.length > 0) {
    console.log(`Historical evidence retained: ${classifiedBuckets.historical_buckets.map((bucket) => bucket.code).join(', ')}`);
  }
}

main().catch((error) => {
  console.error('[diagnose-blog-autopublish] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
