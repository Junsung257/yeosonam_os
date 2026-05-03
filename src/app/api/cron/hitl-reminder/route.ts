import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const maxDuration = 30;

// 30분 이상 처리되지 않은 frozen 에스컬레이션을 재알림
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });

  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();

    const { data: staleTasks, error } = await supabaseAdmin
      .from('agent_tasks')
      .select('id, risk_level, task_context, created_at')
      .eq('status', 'frozen')
      .lt('created_at', thirtyMinAgo)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) throw error;
    if (!staleTasks?.length) return NextResponse.json({ stale: 0 });

    type StaleTask = { id: string; risk_level: string; task_context: unknown; created_at: string };
    const lines = staleTasks.map((t: StaleTask) => {
      const mins = Math.floor(
        (Date.now() - new Date(t.created_at).getTime()) / 60_000,
      );
      return `• [${t.risk_level.toUpperCase()}] task ${t.id.slice(0, 8)}… — ${mins}분 대기`;
    });

    await sendSlackAlert(
      `⏰ [HITL 재알림] 미처리 에스컬레이션 ${staleTasks.length}건 (30분+ 대기)`,
      { items: lines, action: '👉 /admin/escalations' },
    );

    return NextResponse.json({ stale: staleTasks.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
