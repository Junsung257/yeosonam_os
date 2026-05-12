import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SEVERITY = new Set(['info', 'warn', 'error', 'critical']);

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ incidents: [], total: 0 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? '50')));
    const offset = Math.max(0, Number(sp.get('offset') ?? '0'));
    const severity = sp.get('severity');
    const category = sp.get('category');

    let q = supabaseAdmin
      .from('agent_incidents')
      .select(
        'id, correlation_id, task_id, session_id, tenant_id, severity, category, message, details, detected_by, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (severity && ALLOWED_SEVERITY.has(severity)) q = q.eq('severity', severity);
    if (category) q = q.eq('category', category);

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      incidents: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent incidents 조회 실패' },
      { status: 500 },
    );
  }
}

