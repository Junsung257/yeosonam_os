import { NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const getHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ tasks: [], health: null }, { status: 200 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const priorityMax = Math.min(3, Math.max(0, Number(searchParams.get('priority_max') ?? '3')));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '100')));
    const offset = Math.max(0, Number(searchParams.get('offset') ?? '0'));

    const [tasksRes, healthRes, bankRes] = await Promise.all([
      supabaseAdmin.rpc('get_inbox_tasks', {
        p_priority_max: priorityMax,
        p_limit: limit,
        p_offset: offset,
      }),
      supabaseAdmin
        .from('booking_tasks_health')
        .select('*')
        .limit(1),
      supabaseAdmin
        .from('bank_tx_health')
        .select('unmatched_count, review_count, error_count, stale_over_24h')
        .limit(1),
    ]);

    if (tasksRes.error) throw tasksRes.error;
    if (healthRes.error) throw healthRes.error;
    if (bankRes.error) throw bankRes.error;

    return apiResponse({
      tasks: tasksRes.data ?? [],
      health: healthRes.data?.[0] ?? null,
      bank_health: bankRes.data?.[0] ?? null,
    });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
