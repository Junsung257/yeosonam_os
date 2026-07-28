import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';
import { transitionAgentTask } from '@/lib/agent/tasking';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { isAgentApprovalOverdue } from '@/lib/agent-office';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

async function postHandler(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = DecisionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiResponse(
        { error: 'action은 approve 또는 reject여야 하며 reason은 500자 이하여야 합니다.' },
        { status: 400 },
      );
    }

    const approvalId = params.id;
    const { action, reason = null } = parsed.data;
    const reviewer = await resolveAdminActorLabel(request);

    const { data: approval, error: approvalErr } = await supabaseAdmin
      .from('agent_approvals')
      .select('id, task_id, status, requested_at, expires_at')
      .eq('id', approvalId)
      .maybeSingle();
    if (approvalErr) throw approvalErr;
    if (!approval) {
      return apiResponse({ error: '승인 요청을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (approval.status !== 'pending') {
      return apiResponse({ error: '이미 처리된 승인 요청입니다.' }, { status: 409 });
    }
    if (isAgentApprovalOverdue(approval)) {
      return apiResponse(
        { error: '기한이 지난 승인 요청입니다. 현재 상태를 다시 검증해 새 승인 요청을 생성하세요.' },
        { status: 409 },
      );
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const { data: updatedApproval, error: updateErr } = await supabaseAdmin
      .from('agent_approvals')
      .update({
        status: nextStatus,
        reviewed_by: reviewer,
        reviewed_at: new Date().toISOString(),
        reason: reason ?? undefined,
      })
      .eq('id', approvalId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updatedApproval) {
      return apiResponse({ error: '다른 운영자가 이미 처리한 승인 요청입니다.' }, { status: 409 });
    }

    const { data: task, error: taskErr } = await supabaseAdmin
      .from('agent_tasks')
      .select('id, status')
      .eq('id', approval.task_id)
      .maybeSingle();
    if (taskErr) throw taskErr;

    if (task?.status === 'frozen') {
      if (action === 'approve') {
        await transitionAgentTask(task.id, 'frozen', 'resumed', {
          approved_by: reviewer,
        });
      } else {
        await transitionAgentTask(task.id, 'frozen', 'cancelled', {
          approved_by: reviewer,
          last_error: reason ?? 'approval rejected',
        });
      }
    }

    return apiResponse({
      ok: true,
      approvalId,
      status: nextStatus,
      taskId: approval.task_id,
    });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '승인 처리 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);

