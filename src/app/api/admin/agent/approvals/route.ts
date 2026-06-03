import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected', 'expired', 'cancelled']);

async function getHandler(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ approvals: [], total: 0 });
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

    return apiResponse({
      approvals: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return apiResponse({ error: sanitizeDbError(error, 'agent approvals 조회 실패') }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);

