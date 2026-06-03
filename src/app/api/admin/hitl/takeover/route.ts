import { type NextRequest, type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { withAdminGuard } from '@/lib/admin-guard';
import { logWarning } from '@/lib/sentry-logger';
import { apiResponse } from '@/lib/api-response';

// 어드민이 AI 제어권을 가져와 직접 대응할 때 호출
const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ ok: false });

  try {
    const { taskId, adminId, note } = await request.json() as {
      taskId: string;
      adminId?: string;
      note?: string;
    };

    if (!taskId) {
      return apiResponse({ error: 'taskId required' }, { status: 400 });
    }

    // agent_tasks: frozen → resumed, assigned_to = human
    const { error: taskErr } = await supabaseAdmin
      .from('agent_tasks')
      .update({
        status: 'resumed',
        assigned_to: adminId ?? 'human',
      })
      .eq('id', taskId)
      .eq('status', 'frozen');

    if (taskErr) throw taskErr;

    // agent_approvals: 어드민 직접 대응 기록 (감사 로그 — 실패해도 메인 응답 유지)
    const { error: approvalErr } = await supabaseAdmin.from('agent_approvals').insert({
      task_id: taskId,
      status: 'approved',
      requested_by: 'jarvis',
      reviewed_by: adminId ?? 'admin',
      reviewed_at: new Date().toISOString(),
    });
    if (approvalErr) logWarning('[admin/hitl/takeover] agent_approvals insert failed', approvalErr);

    // agent_incidents: 수동 핸드오프 감사 로그 (감사 로그 — 실패해도 메인 응답 유지)
    const { error: incidentErr } = await supabaseAdmin.from('agent_incidents').insert({
      task_id: taskId,
      severity: 'info',
      category: 'manual_handoff',
      message: note ?? '어드민 직접 대응',
      details: { adminId: adminId ?? 'admin', takenOverAt: new Date().toISOString() },
    });
    if (incidentErr) logWarning('[admin/hitl/takeover] agent_incidents insert failed', incidentErr);

    return apiResponse({ ok: true, taskId, status: 'resumed' });
  } catch (err) {
    return apiResponse(
      { error: logAndSanitize('admin-hitl-takeover', err, '처리 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
