/**
 * GET /api/ops/blog-system
 *
 * 블로그 자동 발행 파이프라인 전용 요약 — 어드민 "시스템" 페이지용.
 * (Vercel 대시보드 대신 내부에서 크론·큐·색인 상태 확인)
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

const BLOG_CRON_PREFIX = 'blog-';
const BLOG_CRON_NAMES = new Set([
  'blog-publisher',
  'blog-scheduler',
  'blog-learn',
  'blog-lifecycle',
  'blog-daily-summary',
  'trend-topic-miner',
]);

function isBlogCron(name: string | null | undefined): boolean {
  if (!name) return false;
  if (BLOG_CRON_NAMES.has(name)) return true;
  return name.startsWith(BLOG_CRON_PREFIX);
}

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const { data: health, error: healthErr } = await supabaseAdmin.from('cron_health').select('*');
    if (healthErr) throw healthErr;

    const blogHealth = (health || []).filter((r: { cron_name?: string }) => isBlogCron(r.cron_name));

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentFailures, error: failErr } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status, started_at, elapsed_ms, error_count, error_messages, alerted')
      .neq('status', 'success')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(40);
    if (failErr) throw failErr;

    const blogFailures = (recentFailures || []).filter((r: { cron_name?: string }) =>
      isBlogCron(r.cron_name),
    );

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekRuns } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status')
      .gte('started_at', weekAgo);

    const blogWeek = (weekRuns || []).filter((r: { cron_name?: string }) => isBlogCron(r.cron_name));
    const statsByName: Record<string, { total: number; success: number }> = {};
    for (const r of blogWeek as Array<{ cron_name: string; status: string }>) {
      const s = (statsByName[r.cron_name] ??= { total: 0, success: 0 });
      s.total += 1;
      if (r.status === 'success') s.success += 1;
    }
    const successRate7dPercent: Record<string, number> = {};
    for (const [name, s] of Object.entries(statsByName)) {
      successRate7dPercent[name] = s.total > 0 ? Math.round((s.success / s.total) * 1000) / 10 : 0;
    }

    const { data: qStats } = await supabaseAdmin.from('blog_topic_queue').select('status', { count: 'exact' });
    const queueCounts: Record<string, number> = {};
    (qStats || []).forEach((r: { status?: string }) => {
      const st = r.status || 'unknown';
      queueCounts[st] = (queueCounts[st] || 0) + 1;
    });

    const { data: indexingRecent } = await supabaseAdmin
      .from('indexing_reports')
      .select('url, google_status, google_error, indexnow_status, indexnow_error, reported_at')
      .order('reported_at', { ascending: false })
      .limit(15);

    return NextResponse.json({
      blog_cron_health: blogHealth,
      blog_failures_24h: blogFailures,
      blog_success_rate_7d_percent: successRate7dPercent,
      blog_queue_counts: queueCounts,
      indexing_recent: indexingRecent || [],
      hints: {
        cron_secret_configured: Boolean(process.env.CRON_SECRET),
        base_url_for_cron_fetch: process.env.NEXT_PUBLIC_BASE_URL || null,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
