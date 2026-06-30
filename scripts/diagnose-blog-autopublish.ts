import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { countPublishableQueueCandidates } from '../src/lib/blog-scheduler';
import { getClosedKstDailySummaryRange } from '../src/lib/blog-daily-summary-window';

dotenv.config({ path: '.env.local' });
dotenv.config();

type BucketCode =
  | 'publisher_cron_not_observed'
  | 'publisher_timeout'
  | 'duplicate_candidate_burn'
  | 'table_integrity_fail'
  | 'candidate_shortage'
  | 'audit_contract_mismatch'
  | 'indexing_queue_error';

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
  const yesterday = kstDayRange(kstDayKey(new Date(day.start.getTime() - 1)));

  const [
    publishedTodayRes,
    publishedYesterdayRes,
    recentPublishedRes,
    queueCounts,
    indexingCounts,
    indexingProblemRes,
    activeQueueRes,
    cronHealthRes,
    publisherLogsRes,
    policyRes,
  ] = await Promise.all([
    supabase
      .from('content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', day.start.toISOString())
      .lt('published_at', day.end.toISOString()),
    supabase
      .from('content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .gte('published_at', yesterday.start.toISOString())
      .lt('published_at', yesterday.end.toISOString()),
    supabase
      .from('content_creatives')
      .select('id, slug, content_type, product_id, destination, published_at, generation_meta, quality_gate')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit),
    countByStatus('blog_topic_queue', ['queued', 'generating', 'failed', 'skipped', 'deferred']),
    countByStatus('blog_indexing_jobs', ['pending', 'retry', 'processing', 'succeeded', 'failed']),
    supabase
      .from('blog_indexing_jobs')
      .select('id, slug, status, attempts, max_attempts, next_attempt_at, last_error, updated_at, succeeded_at')
      .in('status', ['pending', 'retry', 'processing', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabase
      .from('blog_topic_queue')
      .select('id, product_id, destination, angle_type, topic, source, meta')
      .in('status', ['queued', 'generating'])
      .limit(500),
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
    recentPublishedRes,
    indexingProblemRes,
    activeQueueRes,
    cronHealthRes,
    publisherLogsRes,
    policyRes,
  ]) {
    if ('error' in result && result.error) throw result.error;
  }

  const policy = policyRes.data?.[0] ?? null;
  const dailyTarget = numberFrom(policy?.posts_per_day) || 4;
  const cronHealth = Object.fromEntries((cronHealthRes.data ?? []).map((row: any) => [row.cron_name, row]));
  const publisherHealth = cronHealth['blog-publisher'];
  const publisherLogs = publisherLogsRes.data ?? [];
  const publishabilityStats = countPublishableQueueCandidates({
    activeQueue: activeQueueRes.data ?? [],
    recentPublished: recentPublishedRes.data ?? [],
  });
  const publishabilitySnapshot = {
    queued_total: (activeQueueRes.data ?? []).filter((row: any) => row.source !== 'pillar').length,
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
  const latestPublisherLog = publisherLogs[0] ?? null;
  const latestPublisherSummary = summaryObject(latestPublisherLog);
  const healthPublisherSummary = lastSummaryObject(publisherHealth);
  const combinedPublisherSummary = Object.keys(latestPublisherSummary).length > 0
    ? latestPublisherSummary
    : healthPublisherSummary;

  const buckets: Bucket[] = [];
  const publisherRanToday = publisherLogs.length > 0 || (
    publisherHealth?.last_run_at &&
    new Date(publisherHealth.last_run_at) >= day.start &&
    new Date(publisherHealth.last_run_at) < day.end
  );

  if (!publisherRanToday) {
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
  if (timeoutRuns.length > 0) {
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

  const tableFailures = failureCount(combinedPublisherSummary, 'table_integrity');
  if (tableFailures > 0 || containsText(publisherLogs, /table_integrity|too_few_table_rows/i)) {
    buckets.push({
      code: 'table_integrity_fail',
      severity: 'high',
      detail: `${tableFailures || 'Some'} candidate(s) failed table integrity checks.`,
      evidence: combinedPublisherSummary.failure_breakdown ?? null,
    });
  }

  const queued = publishabilitySnapshot.publishable_candidate_count;
  if (queued < dailyTarget * 2) {
    buckets.push({
      code: 'candidate_shortage',
      severity: queued === 0 ? 'critical' : 'warning',
      detail: `Only ${queued} publishable blog candidate(s) remain for a target of ${dailyTarget}/day.`,
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

  const report = {
    date: day.dayKey,
    timezone: 'Asia/Seoul',
    generated_at: new Date().toISOString(),
    report_period_closed: day.closed,
    used_previous_day_for_pre_close_run: day.usedPreviousDayForPreCloseRun,
    close_minute_kst: day.closeMinuteKst,
    published: {
      selected_day: publishedTodayRes.count ?? 0,
      previous_day: publishedYesterdayRes.count ?? 0,
      today: publishedTodayRes.count ?? 0,
      yesterday: publishedYesterdayRes.count ?? 0,
      daily_target: dailyTarget,
      under_target: (publishedTodayRes.count ?? 0) < dailyTarget,
    },
    queue: queueCounts,
    publishability: publishabilitySnapshot,
    indexing_jobs: indexingCounts,
    cron_health: cronHealth,
    latest_publisher_runs: publisherLogs,
    buckets,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Blog autopublish diagnosis (${report.date} KST)`);
  console.log(`Published: ${report.published.today}/${dailyTarget} selected day, ${report.published.yesterday} previous day`);
  console.log(`Queue: ${JSON.stringify(queueCounts)}`);
  console.log(`Indexing jobs: ${JSON.stringify(indexingCounts)}`);
  console.log('Buckets:');
  for (const bucket of buckets) {
    console.log(`- [${bucket.severity}] ${bucket.code}: ${bucket.detail}`);
  }
}

main().catch((error) => {
  console.error('[diagnose-blog-autopublish] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
