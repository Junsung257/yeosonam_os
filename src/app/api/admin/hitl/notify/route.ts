import { type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

const RISK_EMOJI: Record<string, string> = {
  critical: '🚨',
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

// JARVIS 에이전트가 에스컬레이션 시 호출하는 엔드포인트
// agent_tasks.status = 'frozen' 설정 + Slack 즉시 알림
const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ ok: false });

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
    const shortMsg = safeRawTextExcerpt(message, 200) ?? '(message omitted)';

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

    return apiResponse({ ok: true, notified: true });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err) },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
