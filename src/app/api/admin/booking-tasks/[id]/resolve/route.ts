import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const postHandler = async (
  request: NextRequest,
  { params }: { params: { id: string } },
) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const resolution = typeof body.resolution === 'string' ? body.resolution : 'manual';
    const actor = typeof body.actor === 'string' && body.actor ? `user:${body.actor}` : 'user:admin';

    const { data, error } = await supabaseAdmin.rpc('resolve_booking_task', {
      p_task_id: params.id,
      p_resolved_by: actor,
      p_resolution: resolution,
    });
    if (error) throw error;

    if (!data) {
      return apiResponse({ error: 'TASK_NOT_FOUND' }, { status: 404 });
    }

    return apiResponse({ task: data });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
