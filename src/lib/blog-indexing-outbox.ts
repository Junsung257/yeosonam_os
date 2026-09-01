import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { IndexingReport } from '@/lib/indexing';
import {
  buildGoogleVisibilitySnapshot,
  buildNaverVisibilitySnapshot,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';
import {
  blogIndexingUrlForSlug,
  canonicalizeBlogIndexingJobUrl,
  resolveBlogCanonicalOrigin,
} from '@/lib/blog-canonical-url';
import {
  BLOG_AUTOPILOT_PIPELINE_VERSION,
  BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  BLOG_SEARCH_CLASSIFICATION_VERSION,
  readBlogDeploymentCommitShaV4,
  resolveBlogSearchLifecycleStatus,
  resolveProviderReceiptStatus,
} from '@/lib/blog-autopilot-v4-contract';

export {
  blogIndexingUrlForSlug,
  canonicalizeBlogIndexingJobUrl,
  resolveBlogCanonicalOrigin,
} from '@/lib/blog-canonical-url';

type BlogIndexingJobType = 'URL_UPDATED' | 'URL_DELETED';

export interface BlogIndexingJobRow {
  id: string;
  content_creative_id: string | null;
  slug: string;
  url: string;
  source: string;
  type: BlogIndexingJobType;
  status: 'pending' | 'retry' | 'processing' | 'succeeded' | 'failed';
  attempts: number;
  max_attempts: number;
}

export interface EnqueueBlogIndexingJobInput {
  slug: string;
  url?: string;
  baseUrl?: string;
  contentCreativeId?: string | null;
  source?: string;
  type?: BlogIndexingJobType;
}

export interface EnqueueBlogIndexingJobResult {
  ok: boolean;
  jobId?: string;
  deduped?: boolean;
  skipped?: boolean;
  error?: string;
}

const TABLE = 'blog_indexing_jobs';
const ACTIVE_STATUSES = ['pending', 'retry', 'processing'];

function dbErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const record = error as { message?: string; code?: string };
  return record.message || record.code || String(error);
}

function dbErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
}

export async function enqueueBlogIndexingJob(
  input: EnqueueBlogIndexingJobInput,
): Promise<EnqueueBlogIndexingJobResult> {
  const slug = input.slug.trim().replace(/^\/+|\/+$/g, '');
  if (!slug) return { ok: false, error: 'slug missing' };
  if (!isSupabaseConfigured) return { ok: false, skipped: true, error: 'Supabase not configured' };

  const type = input.type ?? 'URL_UPDATED';
  const url = canonicalizeBlogIndexingJobUrl({ url: input.url, slug, baseUrl: input.baseUrl });
  const now = new Date().toISOString();
  const payload = {
    content_creative_id: input.contentCreativeId ?? null,
    slug,
    url,
    source: input.source ?? 'publish',
    type,
    status: 'pending',
    next_attempt_at: now,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert(payload)
    .select('id')
    .single();

  if (!error) {
    return { ok: true, jobId: (data as { id?: string } | null)?.id };
  }

  if (dbErrorCode(error) !== '23505') {
    return { ok: false, error: dbErrorMessage(error) };
  }

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from(TABLE)
    .select('id')
    .eq('url', url)
    .eq('type', type)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingError) return { ok: false, error: dbErrorMessage(existingError) };
  const existing = (existingRows as Array<{ id?: string }> | null)?.[0];
  if (!existing?.id) return { ok: false, error: 'active duplicate job not found' };

  const { error: updateError } = await supabaseAdmin
    .from(TABLE)
    .update({
      content_creative_id: input.contentCreativeId ?? null,
      slug,
      source: input.source ?? 'publish',
      updated_at: now,
    })
    .eq('id', existing.id);

  if (updateError) return { ok: false, error: dbErrorMessage(updateError) };
  return { ok: true, jobId: existing.id, deduped: true };
}

export function isIndexingReportSuccessful(report: IndexingReport): boolean {
  const hasAnySuccessfulPath =
    report.google === 'success' ||
    report.indexnow === 'success' ||
    report.sitemap_pings.some((ping) => ping.ok);

  if (!hasAnySuccessfulPath) return false;

  // If IndexNow is configured and was attempted, do not hide that provider failure
  // behind a successful sitemap hint. The worker should retry so Naver/Bing-style
  // channels get another chance with the provider's backoff signal.
  return report.indexnow !== 'failed';
}

export async function persistBlogIndexingReport(
  job: Pick<BlogIndexingJobRow, 'content_creative_id' | 'slug'>,
  report: IndexingReport,
): Promise<void> {
  const providerAccepted = report.google === 'success'
    || report.indexnow === 'success'
    || report.sitemap_pings.some((ping) => ping.ok);
  const providerReceiptStatus = resolveProviderReceiptStatus({
    requestStatus: 'requested',
    providerOk: providerAccepted,
  });
  await supabaseAdmin.from('indexing_reports').insert({
    url: report.url,
    content_creative_id: job.content_creative_id,
    google_status: report.google,
    google_error: report.google_error ?? null,
    indexnow_status: report.indexnow,
    indexnow_error: report.indexnow_error ?? null,
    sitemap_pings: report.sitemap_pings,
    duration_ms: report.duration_ms,
    search_lifecycle_status: resolveBlogSearchLifecycleStatus({
      requestStatus: 'requested',
      providerReceiptStatus,
    }),
    provider_receipt_status: providerReceiptStatus,
    classification_version: BLOG_SEARCH_CLASSIFICATION_VERSION,
    provider_raw_response: report,
    pipeline_version: BLOG_AUTOPILOT_PIPELINE_VERSION,
    deployment_commit_sha: readBlogDeploymentCommitShaV4(),
    schema_migration_version: BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  });

  const naverIndexNowOk = report.sitemap_pings.some(
    (ping) => ping.provider === 'naver_indexnow' && ping.ok === true,
  );

  await Promise.allSettled([
    recordBlogVisibilitySnapshot(
      supabaseAdmin,
      buildGoogleVisibilitySnapshot({
        slug: job.slug,
        url: report.url,
        requestStatus: report.google === 'failed' ? 'request_failed' : 'requested',
        evidence: {
          request_status: report.google,
          request_error: report.google_error ?? null,
          sitemap_pings: report.sitemap_pings,
        },
        source: 'publish_indexing_worker',
      }),
    ),
    recordBlogVisibilitySnapshot(
      supabaseAdmin,
      buildNaverVisibilitySnapshot({
        slug: job.slug,
        url: report.url,
        indexNowOk: naverIndexNowOk,
        evidence: {
          request_status: report.indexnow,
          request_error: report.indexnow_error ?? null,
          sitemap_pings: report.sitemap_pings,
        },
        source: 'publish_indexing_worker',
      }),
    ),
  ]);
}
