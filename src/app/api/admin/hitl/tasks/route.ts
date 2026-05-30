import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

// frozen agent_tasks + jarvis_pending_actions 목록 조회 (에스컬레이션 대시보드용)
const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ tasks: [] });

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const [{ data, error }, { data: pendingActions, error: pendingError }] = await Promise.all([
      supabaseAdmin
        .from('agent_tasks')
        .select('id, correlation_id, status, risk_level, performative, task_context, created_at, assigned_to')
        .eq('status', 'frozen')
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('jarvis_pending_actions')
        .select('id, session_id, agent_type, tool_name, tool_args, description, risk_level, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (error) throw error;
    if (pendingError) throw pendingError;

    const mappedPending = (pendingActions ?? []).map((a: any) => ({
      id: a.id,
      correlation_id: a.session_id ?? a.id,
      status: 'frozen',
      risk_level: a.risk_level ?? 'medium',
      performative: 'approve',
      task_context: {
        userMessage: a.description,
        summary: a.description,
        toolName: a.tool_name,
        toolArgs: a.tool_args,
        source: 'jarvis_pending_actions',
      },
      created_at: a.created_at,
      assigned_to: null,
      task_kind: 'pending_action',
      pending_action_id: a.id,
    }));

    const tasks = [...(data ?? []), ...mappedPending]
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);
