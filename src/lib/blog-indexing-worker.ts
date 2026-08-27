import { notifyIndexing } from '@/lib/indexing';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  canonicalizeBlogIndexingJobUrl,
  isIndexingReportSuccessful,
  persistBlogIndexingReport,
  type BlogIndexingJobRow,
} from '@/lib/blog-indexing-outbox';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';

const TABLE = 'blog_indexing_jobs';
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

export interface BlogIndexingWorkerSummary {
  [key: string]: unknown;
  skipped?: boolean;
  reason?: string;
  processed: number;
  succeeded?: number;
  retry?: number;
  failed?: number;
  ineligible?: number;
  stale_reset: number;
  snapshot_refresh?: 'not_needed' | 'succeeded' | 'failed';
  snapshot_refresh_result?: unknown;
  results: Array<{ id: string; slug: string; status: string; error?: string }>;
  errors: string[];
}

async function refreshBlogPublicSnapshotsForIndexingV3(): Promise<unknown> {
  const { data, error } = await supabaseAdmin.rpc('refresh_blog_public_snapshots_v3');
  if (error) throw new Error(`public snapshot refresh failed:${error.message}`);
  return data;
}

function batchSize(limit?: number): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return Math.min(MAX_BATCH_SIZE, Math.floor(limit));
  }
  const parsed = Number.parseInt(process.env.BLOG_INDEXING_WORKER_BATCH || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, parsed);
}

function retryDelayMs(attempt: number): number {
  const minutes = Math.min(360, Math.max(5, 5 * 2 ** Math.max(0, attempt - 1)));
  return minutes * 60 * 1000;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

async function isBlogIndexingJobPubliclyEligible(job: BlogIndexingJobRow): Promise<boolean> {
  if (job.type === 'URL_DELETED') return true;

  let query = supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select('id, slug')
    .eq('slug', job.slug);
  if (job.content_creative_id) {
    query = query.eq('id', job.content_creative_id);
  }
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`public eligibility check failed:${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

class BlogIndexingProviderError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'BlogIndexingProviderError';
  }
}

function isPublicIndexingOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveBlogIndexingBaseUrl(jobUrl: string, optionBaseUrl?: string): string {
  const candidates = [
    optionBaseUrl,
    jobUrl,
    process.env.BLOG_CANONICAL_ORIGIN,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    'https://www.yeosonam.com',
  ];

  for (const candidate of candidates) {
    if (!isPublicIndexingOrigin(candidate)) continue;
    const parsed = new URL(candidate);
    return parsed.origin;
  }

  return 'https://www.yeosonam.com';
}

async function resetStaleProcessingJobs(now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: 'retry',
      locked_at: null,
      locked_by: null,
      last_error: 'stale processing lock reset',
      next_attempt_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('status', 'processing')
    .lt('locked_at', staleBefore)
    .select('id');

  if (error) throw error;
  return (data as Array<{ id: string }> | null)?.length ?? 0;
}

export async function processDueBlogIndexingJobs(options: {
  limit?: number;
  workerName?: string;
  baseUrl?: string;
} = {}): Promise<BlogIndexingWorkerSummary> {
  if (!isSupabaseConfigured) {
    return {
      skipped: true,
      reason: 'Supabase not configured',
      processed: 0,
      stale_reset: 0,
      results: [],
      errors: [],
    };
  }

  const now = new Date();
  const workerId = `${options.workerName ?? 'blog-indexing-worker'}-${now.getTime()}`;
  const errors: string[] = [];
  const results: BlogIndexingWorkerSummary['results'] = [];

  let staleReset = 0;
  try {
    staleReset = await resetStaleProcessingJobs(now);
  } catch (err) {
    errors.push(`stale reset failed: ${errorMessage(err)}`);
  }

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from(TABLE)
    .select('id, content_creative_id, slug, url, source, type, status, attempts, max_attempts')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(batchSize(options.limit));

  if (jobsError) {
    errors.push(`job fetch failed: ${jobsError.message}`);
    return { processed: 0, stale_reset: staleReset, errors, results };
  }

  const dueJobs = (jobs ?? []) as BlogIndexingJobRow[];
  if (dueJobs.length === 0) {
    return {
      processed: 0,
      stale_reset: staleReset,
      snapshot_refresh: 'not_needed',
      results,
      errors,
    };
  }

  let snapshotRefreshResult: unknown;
  try {
    // Indexing must reflect the same durable snapshot served to visitors.
    // If this refresh fails, leave every outbox row unclaimed for a retry.
    snapshotRefreshResult = await refreshBlogPublicSnapshotsForIndexingV3();
  } catch (err) {
    const message = errorMessage(err);
    errors.push(message);
    return {
      processed: 0,
      stale_reset: staleReset,
      snapshot_refresh: 'failed',
      results,
      errors,
    };
  }

  for (const job of dueJobs) {
    const attempt = (job.attempts ?? 0) + 1;
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from(TABLE)
      .update({
        status: 'processing',
        attempts: attempt,
        locked_at: claimedAt,
        locked_by: workerId,
        updated_at: claimedAt,
      })
      .eq('id', job.id)
      .in('status', ['pending', 'retry'])
      .select('id')
      .maybeSingle();

    if (claimError) {
      errors.push(`${job.id} claim failed: ${claimError.message}`);
      results.push({ id: job.id, slug: job.slug, status: 'claim_failed', error: claimError.message });
      continue;
    }
    if (!claimed) {
      results.push({ id: job.id, slug: job.slug, status: 'claim_skipped' });
      continue;
    }

    try {
      const canonicalUrl = canonicalizeBlogIndexingJobUrl({
        url: job.url,
        slug: job.slug,
        baseUrl: options.baseUrl,
      });
      const baseUrl = resolveBlogIndexingBaseUrl(canonicalUrl, options.baseUrl);
      const publiclyEligible = await isBlogIndexingJobPubliclyEligible(job);
      if (!publiclyEligible) {
        const skippedAt = new Date().toISOString();
        const { error: skipError } = await supabaseAdmin
          .from(TABLE)
          .update({
            status: 'skipped',
            locked_at: null,
            locked_by: null,
            last_error: 'public eligibility check failed closed',
            updated_at: skippedAt,
          })
          .eq('id', job.id);
        if (skipError) throw new Error(`ineligible job update failed:${skipError.message}`);
        results.push({ id: job.id, slug: job.slug, status: 'skipped_ineligible' });
        continue;
      }
      const report = await notifyIndexing(canonicalUrl, baseUrl, {
        type: job.type,
        pingSitemap: false,
      });
      await persistBlogIndexingReport(job, report);

      if (!isIndexingReportSuccessful(report)) {
        const retryAfter = report.indexnow_retry_after_ms;
        const retrySuffix = retryAfter ? `; retry_after_ms=${retryAfter}` : '';
        throw new BlogIndexingProviderError(
          `indexing providers failed: google=${report.google}; indexnow=${report.indexnow}${retrySuffix}`,
          retryAfter,
        );
      }

      const { error: successUpdateError } = await supabaseAdmin
        .from(TABLE)
        .update({
          status: 'succeeded',
          locked_at: null,
          locked_by: null,
          last_error: null,
          last_report: report as never,
          succeeded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      if (successUpdateError) {
        throw new Error(`indexing success persistence failed:${successUpdateError.message}`);
      }

      const { error: operationIndexedError } = await supabaseAdmin.rpc(
        'mark_blog_content_operation_indexed_v4',
        { p_indexing_job_id: job.id },
      );
      if (operationIndexedError && operationIndexedError.code !== '42883') {
        throw new Error(`content operation indexing sync failed:${operationIndexedError.message}`);
      }

      results.push({ id: job.id, slug: job.slug, status: 'succeeded' });
    } catch (err) {
      const message = errorMessage(err).slice(0, 1000);
      const exhausted = attempt >= (job.max_attempts ?? 6);
      const providerRetryAfterMs = err instanceof BlogIndexingProviderError ? err.retryAfterMs : undefined;
      const nextDelayMs = Math.max(retryDelayMs(attempt), providerRetryAfterMs ?? 0);
      const nextAttemptAt = new Date(Date.now() + nextDelayMs).toISOString();

      const { error: updateError } = await supabaseAdmin
        .from(TABLE)
        .update({
          status: exhausted ? 'failed' : 'retry',
          locked_at: null,
          locked_by: null,
          last_error: message,
          next_attempt_at: exhausted ? new Date().toISOString() : nextAttemptAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      if (updateError) errors.push(`${job.id} retry update failed: ${updateError.message}`);
      errors.push(`${job.slug}: ${message}`);
      results.push({ id: job.id, slug: job.slug, status: exhausted ? 'failed' : 'retry', error: message });
    }
  }

  return {
    processed: results.filter((result) => ['succeeded', 'retry', 'failed', 'skipped_ineligible'].includes(result.status)).length,
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    retry: results.filter((result) => result.status === 'retry').length,
    failed: results.filter((result) => result.status === 'failed').length,
    ineligible: results.filter((result) => result.status === 'skipped_ineligible').length,
    stale_reset: staleReset,
    snapshot_refresh: 'succeeded',
    snapshot_refresh_result: snapshotRefreshResult,
    results,
    errors,
  };
}
