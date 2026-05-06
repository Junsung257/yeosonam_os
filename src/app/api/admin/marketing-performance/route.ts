import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// 하위호환 alias
function last7Days(): string[] { return lastNDays(7); }

function buildMockPerformance() {
  const days = last7Days();
  return {
    period: 'last_7d',
    metrics: {
      ad: { roas_pct: 285, total_spend: 470000, total_revenue: 1339500 },
      content: { blog_posts_published: 14, avg_serp_rank: 8.3 },
      pipeline: { tasks_done: 47, tasks_failed: 3, success_rate: 94 },
    },
    trend: days.map((date, i) => ({
      date,
      roas_pct: 240 + i * 15,
      blog_count: 1 + (i % 3),
      tasks_done: 5 + i,
      tasks_failed: i % 3 === 0 ? 1 : 0,
    })),
    recent_tasks: [
      { agent_type: 'marketing', performative: 'card_news_generate', status: 'done', started_at: new Date(Date.now() - 300_000).toISOString(), completed_at: new Date(Date.now() - 295_000).toISOString(), duration_ms: 5000, last_error: null },
      { agent_type: 'operations', performative: 'booking_lookup', status: 'done', started_at: new Date(Date.now() - 600_000).toISOString(), completed_at: new Date(Date.now() - 598_000).toISOString(), duration_ms: 2000, last_error: null },
      { agent_type: 'finance', performative: 'settlement_calc', status: 'failed', started_at: new Date(Date.now() - 900_000).toISOString(), completed_at: new Date(Date.now() - 895_000).toISOString(), duration_ms: 5000, last_error: '정산 데이터 누락' },
    ],
    mock: true,
  };
}

/**
 * GET /api/admin/marketing-performance
 *
 * 광고(Ad) + 콘텐츠(Blog/SERP) + 에이전트(Pipeline) 3채널 지표 집약
 * - period: last_7d (고정)
 * - metrics: 채널별 요약 KPI
 * - trend: 7일 시계열 (recharts LineChart용)
 * - recent_tasks: 에이전트 실행 최신 20건
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json(buildMockPerformance());
  }

  const daysParam = Math.min(
    parseInt(request.nextUrl.searchParams.get('days') ?? '7', 10),
    90,
  );
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;

  try {
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceISO = since.toISOString();

    const [marketingLogsRes, serpRes, agentTasksRes, keywordRes] = await Promise.all([
      supabaseAdmin
        .from('marketing_logs')
        .select('platform, created_at')
        .gte('created_at', sinceISO),

      supabaseAdmin
        .from('serp_rank_snapshots')
        .select('position, checked_at')
        .gte('checked_at', sinceISO),

      supabaseAdmin
        .from('agent_tasks')
        .select('status, agent_type, performative, last_error, started_at, completed_at, created_at')
        .gte('created_at', sinceISO)
        .in('status', ['done', 'failed'])
        .order('completed_at', { ascending: false })
        .limit(200),

      supabaseAdmin
        .from('keyword_performances')
        .select('total_spend, total_revenue, roas_pct, updated_at')
        .gte('updated_at', sinceISO)
        .order('updated_at', { ascending: false })
        .limit(100),
    ]);

    type LogRow     = { platform: string; created_at: string | null };
    type SerpRow    = { position: number | null; checked_at: string | null };
    type TaskRow    = { status: string; agent_type: string; performative: string; last_error: string | null; started_at: string | null; completed_at: string | null; created_at: string | null };
    type KeywordRow = { total_spend: number | null; total_revenue: number | null; roas_pct: number | null; updated_at: string | null };

    const logs     = (marketingLogsRes.data ?? []) as LogRow[];
    const serpRows = (serpRes.data ?? [])          as SerpRow[];
    const tasks    = (agentTasksRes.data ?? [])    as TaskRow[];
    const keywords = (keywordRes.data ?? [])       as KeywordRow[];

    // ── Metrics 요약 ──────────────────────────────────────────────────
    const blog_posts_published = logs.length;

    const avg_serp_rank =
      serpRows.length > 0
        ? Math.round(
            (serpRows.reduce((s, r) => s + (r.position ?? 0), 0) / serpRows.length) * 10,
          ) / 10
        : null;

    const total_spend = keywords.reduce((s, k) => s + (k.total_spend ?? 0), 0);
    const total_revenue = keywords.reduce((s, k) => s + (k.total_revenue ?? 0), 0);
    const roas_pct = total_spend > 0 ? Math.round((total_revenue / total_spend) * 100) : 0;

    // ── N일 시계열 + 집계 (단일 패스, O(n)) ─────────────────────────
    const daysList = lastNDays(days);
    const logsByDate = new Map<string, number>();
    const tasksDoneByDate = new Map<string, number>();
    const tasksFailedByDate = new Map<string, number>();
    const spendByDate = new Map<string, number>();
    const revenueByDate = new Map<string, number>();
    let tasks_done = 0;
    let tasks_failed = 0;
    for (const l of logs) {
      const d = l.created_at?.slice(0, 10);
      if (d) logsByDate.set(d, (logsByDate.get(d) ?? 0) + 1);
    }
    for (const t of tasks) {
      const d = (t.completed_at ?? t.created_at)?.slice(0, 10);
      if (!d) continue;
      if (t.status === 'done') {
        tasks_done++;
        tasksDoneByDate.set(d, (tasksDoneByDate.get(d) ?? 0) + 1);
      } else {
        tasks_failed++;
        tasksFailedByDate.set(d, (tasksFailedByDate.get(d) ?? 0) + 1);
      }
    }
    for (const k of keywords) {
      const d = k.updated_at?.slice(0, 10);
      if (!d) continue;
      spendByDate.set(d, (spendByDate.get(d) ?? 0) + (k.total_spend ?? 0));
      revenueByDate.set(d, (revenueByDate.get(d) ?? 0) + (k.total_revenue ?? 0));
    }
    const total_tasks = tasks_done + tasks_failed;
    const success_rate = total_tasks > 0 ? Math.round((tasks_done / total_tasks) * 100) : 100;
    const trend = daysList.map((date) => {
      const daySpend = spendByDate.get(date) ?? 0;
      const dayRevenue = revenueByDate.get(date) ?? 0;
      return {
        date,
        roas_pct: daySpend > 0 ? Math.round((dayRevenue / daySpend) * 100) : null,
        blog_count: logsByDate.get(date) ?? 0,
        tasks_done: tasksDoneByDate.get(date) ?? 0,
        tasks_failed: tasksFailedByDate.get(date) ?? 0,
      };
    });

    // ── 최근 에이전트 실행 20건 ────────────────────────────────────────
    const recent_tasks = tasks.slice(0, 20).map((t) => ({
      agent_type: t.agent_type,
      performative: t.performative,
      status: t.status,
      started_at: t.started_at,
      completed_at: t.completed_at,
      duration_ms:
        t.started_at && t.completed_at
          ? new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()
          : null,
      last_error: t.last_error,
    }));

    return NextResponse.json({
      period: `last_${days}d`,
      metrics: {
        ad: { roas_pct, total_spend, total_revenue },
        content: { blog_posts_published, avg_serp_rank },
        pipeline: { tasks_done, tasks_failed, success_rate },
      },
      trend,
      recent_tasks,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
