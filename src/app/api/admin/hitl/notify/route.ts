import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

const RISK_EMOJI: Record<string, string> = {
  critical: '🚨',
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

// JARVIS 에이전트가 에스컬레이션 시 호출하는 엔드포인트
// agent_tasks.status = 'frozen' 설정 + Slack 즉시 알림
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: false });

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { taskId, riskLevel = 'medium', message, conversationId, toolName } = body as {
      taskId?: string;
      riskLevel?: string;
      message?: string;
      conversationId?: string;
      toolName?: string;
    };

    // agent_tasks 상태를 frozen으로 업데이트
    if (taskId) {
      await supabaseAdmin
        .from('agent_tasks')
        .update({ status: 'frozen', assigned_to: null })
        .eq('id', taskId)
        .in('status', ['queued', 'running']);
    }

    const emoji = RISK_EMOJI[riskLevel] ?? '⚠️';
    const shortMsg = message ? message.slice(0, 200) : '(메시지 없음)';

    await sendSlackAlert(
      `${emoji} [JARVIS 에스컬레이션] 위험도: ${riskLevel.toUpperCase()} — 즉시 확인 필요`,
      {
        taskId: taskId ?? '-',
        riskLevel,
        tool: toolName ?? '-',
        message: shortMsg,
        conversationId: conversationId ?? '-',
        action: '👉 확인 → /admin/escalations',
        triggeredAt: new Date().toISOString(),
      },
    );

    return NextResponse.json({ ok: true, notified: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
