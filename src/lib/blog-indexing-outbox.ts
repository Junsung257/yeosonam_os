import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { IndexingReport } from '@/lib/indexing';
import {
  buildGoogleVisibilitySnapshot,
  buildNaverVisibilitySnapshot,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';

export type BlogIndexingJobType = 'URL_UPDATED' | 'URL_DELETED';

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

function cleanBaseUrl(baseUrl?: string | null): string {
  const configured = (baseUrl || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!configured || /localhost|127\.0\.0\.1/i.test(configured)) {
    return 'https://www.yeosonam.com';
  }
  return configured;
}

export function blogIndexingUrlForSlug(slug: string, baseUrl?: string | null): string {
  return `${cleanBaseUrl(baseUrl)}/blog/${slug.replace(/^\/+|\/+$/g, '')}`;
}

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
  const url = input.url || blogIndexingUrlForSlug(slug, input.baseUrl);
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
  if (report.google === 'success' || report.indexnow === 'success') return true;
  return report.sitemap_pings.some((ping) => ping.ok);
}

export async function persistBlogIndexingReport(
  job: Pick<BlogIndexingJobRow, 'content_creative_id' | 'slug'>,
  report: IndexingReport,
): Promise<void> {
  await supabaseAdmin.from('indexing_reports').insert({
    url: report.url,
    content_creative_id: job.content_creative_id,
    google_status: report.google,
    google_error: report.google_error ?? null,
    indexnow_status: report.indexnow,
    indexnow_error: report.indexnow_error ?? null,
    sitemap_pings: report.sitemap_pings,
    duration_ms: report.duration_ms,
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
