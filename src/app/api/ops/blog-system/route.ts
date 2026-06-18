/**
 * GET /api/ops/blog-system
 *
 * Summarizes blog automation health for the internal ops dashboard.
 */
import { apiResponse } from '@/lib/api-response';
import { checkPublicBlogSurfaces, type BlogPublicSurfaceCheckReport } from '@/lib/blog-public-surface-check';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BLOG_CRON_PREFIX = 'blog-';
const BLOG_SYSTEM_DB_TIMEOUT_MS = 4500;
const BLOG_CRON_NAMES = new Set([
  'blog-publisher',
  'blog-scheduler',
  'blog-learn',
  'blog-lifecycle',
  'blog-daily-summary',
  'trend-topic-miner',
  'serp-rank-snapshot',
  'rank-tracking',
]);

function isBlogCron(name: string | null | undefined): boolean {
  if (!name) return false;
  if (BLOG_CRON_NAMES.has(name)) return true;
  return name.startsWith(BLOG_CRON_PREFIX);
}

function responseHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

function buildHints() {
  return {
    cron_secret_configured: Boolean(getSecret('CRON_SECRET')),
    base_url_for_cron_fetch: process.env.NEXT_PUBLIC_BASE_URL || null,
  };
}

async function withBlogSystemDbTimeout<T>(read: PromiseLike<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve(read),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${BLOG_SYSTEM_DB_TIMEOUT_MS}ms`));
        }, BLOG_SYSTEM_DB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failedPublicSurfaceReport(err: unknown): BlogPublicSurfaceCheckReport {
  return {
    ok: false,
    checked: 0,
    failed: 1,
    warn: 0,
    results: [{
      id: 'public-surface-check',
      label: 'Public surface check',
      kind: 'api',
      path: '/api/ops/blog-system',
      url: '/api/ops/blog-system',
      critical: true,
      ok: false,
      status: null,
      elapsed_ms: 0,
      bytes: 0,
      cache: null,
      issues: [err instanceof Error ? err.message : 'public_surface_check_failed'],
    }],
    generated_at: new Date().toISOString(),
  };
}

function emptyBlogSystemPayload(publicSurfaces: BlogPublicSurfaceCheckReport, dbError?: string) {
  return {
    status: 'degraded',
    blog_cron_health: [],
    blog_failures_24h: [],
    blog_success_rate_7d_percent: {},
    blog_queue_counts: {},
    indexing_recent: [],
    public_surfaces: publicSurfaces,
    db_error: dbError ?? null,
    hints: buildHints(),
    generated_at: new Date().toISOString(),
  };
}

function publicSurfaceBaseUrl(request: NextRequest): string {
  return request.nextUrl.origin.replace(/\/+$/, '');
}

export async function GET(request: NextRequest) {
  const publicSurfacesPromise = checkPublicBlogSurfaces({ baseUrl: publicSurfaceBaseUrl(request) })
    .catch((err) => failedPublicSurfaceReport(err));

  if (!isSupabaseConfigured) {
    const publicSurfaces = await publicSurfacesPromise;
    return apiResponse(emptyBlogSystemPayload(publicSurfaces, 'Supabase is not configured'), {
      status: 200,
      headers: responseHeaders(),
    });
  }

  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      { data: health, error: healthErr },
      { data: recentFailures, error: failErr },
      { data: weekRuns, error: weekErr },
      { data: qStats, error: qStatsErr },
      { data: indexingRecent, error: indexingErr },
    ] = await Promise.all([
      withBlogSystemDbTimeout(supabaseAdmin.from('cron_health').select('*'), 'cron_health'),
      withBlogSystemDbTimeout(
        supabaseAdmin
          .from('cron_run_logs')
          .select('cron_name, status, started_at, elapsed_ms, error_count, error_messages, alerted')
          .neq('status', 'success')
          .gte('started_at', dayAgo)
          .order('started_at', { ascending: false })
          .limit(40),
        'cron_run_logs_recent',
      ),
      withBlogSystemDbTimeout(
        supabaseAdmin
          .from('cron_run_logs')
          .select('cron_name, status')
          .gte('started_at', weekAgo),
        'cron_run_logs_week',
      ),
      withBlogSystemDbTimeout(
        supabaseAdmin.from('blog_topic_queue').select('status', { count: 'exact' }),
        'blog_topic_queue',
      ),
      withBlogSystemDbTimeout(
        supabaseAdmin
          .from('indexing_reports')
          .select('url, google_status, google_error, indexnow_status, indexnow_error, reported_at')
          .order('reported_at', { ascending: false })
          .limit(15),
        'indexing_reports',
      ),
    ]);

    if (healthErr) throw healthErr;
    const blogHealth = (health || []).filter((row: { cron_name?: string }) => isBlogCron(row.cron_name));

    if (failErr) throw failErr;
    if (weekErr) throw weekErr;
    if (qStatsErr) throw qStatsErr;
    if (indexingErr) throw indexingErr;

    const blogFailures = (recentFailures || []).filter((row: { cron_name?: string }) =>
      isBlogCron(row.cron_name),
    );

    const blogWeek = (weekRuns || []).filter((row: { cron_name?: string }) => isBlogCron(row.cron_name));
    const statsByName: Record<string, { total: number; success: number }> = {};
    for (const run of blogWeek as Array<{ cron_name: string; status: string }>) {
      const stats = (statsByName[run.cron_name] ??= { total: 0, success: 0 });
      stats.total += 1;
      if (run.status === 'success') stats.success += 1;
    }

    const successRate7dPercent: Record<string, number> = {};
    for (const [name, stats] of Object.entries(statsByName)) {
      successRate7dPercent[name] = stats.total > 0
        ? Math.round((stats.success / stats.total) * 1000) / 10
        : 0;
    }

    const queueCounts: Record<string, number> = {};
    (qStats || []).forEach((row: { status?: string }) => {
      const status = row.status || 'unknown';
      queueCounts[status] = (queueCounts[status] || 0) + 1;
    });

    const publicSurfaces = await publicSurfacesPromise;

    return apiResponse({
      status: publicSurfaces.ok ? 'healthy' : 'degraded',
      blog_cron_health: blogHealth,
      blog_failures_24h: blogFailures,
      blog_success_rate_7d_percent: successRate7dPercent,
      blog_queue_counts: queueCounts,
      indexing_recent: indexingRecent || [],
      public_surfaces: publicSurfaces,
      db_error: null,
      hints: buildHints(),
      generated_at: new Date().toISOString(),
    }, {
      headers: responseHeaders(),
    });
  } catch (err) {
    const dbError = sanitizeDbError(err, 'blog system database read failed');
    const publicSurfaces = await publicSurfacesPromise;
    console.error('[ops/blog-system] failed:', dbError);
    return apiResponse(emptyBlogSystemPayload(publicSurfaces, dbError), {
      status: 200,
      headers: responseHeaders(),
    });
  }
}
