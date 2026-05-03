import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { transitionAgentTask } from '@/lib/agent/tasking';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const approvalId = params.id;
    const body = await request.json().catch(() => ({}));
    const action = body?.action === 'reject' ? 'reject' : 'approve';
    const reviewer = typeof body?.reviewedBy === 'string' ? body.reviewedBy : 'admin:manual';
    const reason = typeof body?.reason === 'string' ? body.reason : null;

    const { data: approval, error: approvalErr } = await supabaseAdmin
      .from('agent_approvals')
      .select('id, task_id, status')
      .eq('id', approvalId)
      .maybeSingle();
    if (approvalErr) throw approvalErr;
    if (!approval) {
      return NextResponse.json({ error: '승인 요청을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (approval.status !== 'pending') {
      return NextResponse.json({ error: '이미 처리된 승인 요청입니다.' }, { status: 409 });
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const { error: updateErr } = await supabaseAdmin
      .from('agent_approvals')
      .update({
        status: nextStatus,
        reviewed_by: reviewer,
        reviewed_at: new Date().toISOString(),
        reason: reason ?? undefined,
      })
      .eq('id', approvalId)
      .eq('status', 'pending');
    if (updateErr) throw updateErr;

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

    return NextResponse.json({
      ok: true,
      approvalId,
      status: nextStatus,
      taskId: approval.task_id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '승인 처리 실패' },
      { status: 500 },
    );
  }
}

