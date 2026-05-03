import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// 어드민이 AI 제어권을 가져와 직접 대응할 때 호출
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: false });

  try {
    const { taskId, adminId, note } = await request.json() as {
      taskId: string;
      adminId?: string;
      note?: string;
    };

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
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

    // agent_approvals: 어드민 직접 대응 기록
    await supabaseAdmin.from('agent_approvals').insert({
      task_id: taskId,
      status: 'approved',
      requested_by: 'jarvis',
      reviewed_by: adminId ?? 'admin',
      reviewed_at: new Date().toISOString(),
    });

    // agent_incidents: 수동 핸드오프 감사 로그
    await supabaseAdmin.from('agent_incidents').insert({
      task_id: taskId,
      severity: 'info',
      category: 'manual_handoff',
      message: note ?? '어드민 직접 대응',
      details: { adminId: adminId ?? 'admin', takenOverAt: new Date().toISOString() },
    });

    return NextResponse.json({ ok: true, taskId, status: 'resumed' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
