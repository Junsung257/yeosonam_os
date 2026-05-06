import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// frozen 상태의 agent_tasks 목록 조회 (에스컬레이션 대시보드용)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ tasks: [] });

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_tasks')
      .select('id, correlation_id, status, risk_level, performative, task_context, created_at, assigned_to')
      .eq('status', 'frozen')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
