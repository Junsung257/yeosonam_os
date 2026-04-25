/**
 * GET /api/ops/cron-health
 *
 * 전체 크론의 최근 실행 상태 + 최근 24h 실패 이력 반환.
 * 향후 Ops 대시보드 / booking_tasks Inbox "시스템 상태" 섹션에서 사용.
 *
 * 인증: admin 세션 또는 CRON_SECRET Bearer (Vercel cron 내부 점검용).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // admin 세션은 middleware 가 보장 (비공개 경로). CRON_SECRET 는 서버-to-서버 용.
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  // middleware 에서 이 경로를 통과시킨 상태 (admin 세션 있음) OR cron secret 일치 → 허용
  // 그 외 (/api/ ops 이므로 middleware 가 차단) → 여기 도달 못함

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    // 1. 각 크론의 최근 상태 (view)
    const { data: health, error: healthErr } = await supabaseAdmin
      .from('cron_health')
      .select('*');
    if (healthErr) throw healthErr;

    // 2. 최근 24h 실패 이력
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentFailures, error: failErr } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status, started_at, elapsed_ms, error_count, error_messages, alerted')
      .neq('status', 'success')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(50);
    if (failErr) throw failErr;

    // 3. 크론별 7일 성공률
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekRuns } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status')
      .gte('started_at', weekAgo);
    const statsByName: Record<string, { total: number; success: number; error: number }> = {};
    for (const r of (weekRuns ?? []) as Array<{ cron_name: string; status: string }>) {
      const s = statsByName[r.cron_name] ??= { total: 0, success: 0, error: 0 };
      s.total += 1;
      if (r.status === 'success') s.success += 1;
      else if (r.status === 'error') s.error += 1;
    }
    const successRate7d: Record<string, number> = {};
    for (const [name, s] of Object.entries(statsByName)) {
      successRate7d[name] = s.total > 0 ? Math.round((s.success / s.total) * 1000) / 10 : 0;
    }

    return NextResponse.json({
      health,
      recent_failures_24h: recentFailures,
      success_rate_7d_percent: successRate7d,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
