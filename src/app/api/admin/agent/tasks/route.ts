import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUS = new Set([
  'queued',
  'running',
  'frozen',
  'resumed',
  'done',
  'failed',
  'expired',
  'cancelled',
]);

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ tasks: [], total: 0 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? '50')));
    const offset = Math.max(0, Number(sp.get('offset') ?? '0'));
    const status = sp.get('status');
    const risk = sp.get('risk');

    let q = supabaseAdmin
      .from('agent_tasks')
      .select(
        'id, correlation_id, session_id, tenant_id, source, agent_type, specialist_id, performative, risk_level, status, retry_count, max_retries, last_error, created_by, assigned_to, approved_by, started_at, completed_at, expires_at, created_at, updated_at, task_context',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && ALLOWED_STATUS.has(status)) q = q.eq('status', status);
    if (risk) q = q.eq('risk_level', risk);

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      tasks: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent tasks 조회 실패' },
      { status: 500 },
    );
  }
}

