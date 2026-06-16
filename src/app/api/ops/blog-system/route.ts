/**
 * GET /api/ops/blog-system
 *
 * Summarizes blog automation health for the internal ops dashboard.
 */
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BLOG_CRON_PREFIX = 'blog-';
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

export async function GET() {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const { data: health, error: healthErr } = await supabaseAdmin.from('cron_health').select('*');
    if (healthErr) throw healthErr;

    const blogHealth = (health || []).filter((row: { cron_name?: string }) => isBlogCron(row.cron_name));

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentFailures, error: failErr } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status, started_at, elapsed_ms, error_count, error_messages, alerted')
      .neq('status', 'success')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(40);
    if (failErr) throw failErr;

    const blogFailures = (recentFailures || []).filter((row: { cron_name?: string }) =>
      isBlogCron(row.cron_name),
    );

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekRuns } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status')
      .gte('started_at', weekAgo);

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

    const { data: qStats } = await supabaseAdmin.from('blog_topic_queue').select('status', { count: 'exact' });
    const queueCounts: Record<string, number> = {};
    (qStats || []).forEach((row: { status?: string }) => {
      const status = row.status || 'unknown';
      queueCounts[status] = (queueCounts[status] || 0) + 1;
    });

    const { data: indexingRecent } = await supabaseAdmin
      .from('indexing_reports')
      .select('url, google_status, google_error, indexnow_status, indexnow_error, reported_at')
      .order('reported_at', { ascending: false })
      .limit(15);

    return apiResponse({
      blog_cron_health: blogHealth,
      blog_failures_24h: blogFailures,
      blog_success_rate_7d_percent: successRate7dPercent,
      blog_queue_counts: queueCounts,
      indexing_recent: indexingRecent || [],
      hints: {
        cron_secret_configured: Boolean(getSecret('CRON_SECRET')),
        base_url_for_cron_fetch: process.env.NEXT_PUBLIC_BASE_URL || null,
      },
      generated_at: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[ops/blog-system] failed:', sanitizeDbError(err));
    return apiResponse(
      { error: '블로그 시스템 상태 조회에 실패했습니다.' },
      { status: 500 },
    );
  }
}
