import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected', 'expired', 'cancelled']);

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ approvals: [], total: 0 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? '50')));
    const offset = Math.max(0, Number(sp.get('offset') ?? '0'));
    const status = sp.get('status');

    let q = supabaseAdmin
      .from('agent_approvals')
      .select(
        'id, task_id, action_id, status, reason, requested_by, reviewed_by, requested_at, reviewed_at, expires_at, metadata',
        { count: 'exact' },
      )
      .order('requested_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && ALLOWED_STATUS.has(status)) q = q.eq('status', status);

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      approvals: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'agent approvals 조회 실패' },
      { status: 500 },
    );
  }
}

