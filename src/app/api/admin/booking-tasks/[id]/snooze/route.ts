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
    let until: string | null = null;

    if (typeof body.snoozed_until === 'string') {
      const parsed = new Date(body.snoozed_until);
      if (isNaN(parsed.getTime())) {
        return apiResponse({ error: 'INVALID_SNOOZED_UNTIL' }, { status: 400 });
      }
      until = parsed.toISOString();
    } else if (typeof body.hours === 'number' && body.hours > 0) {
      until = new Date(Date.now() + body.hours * 60 * 60 * 1000).toISOString();
    } else {
      return apiResponse({ error: 'SNOOZED_UNTIL_OR_HOURS_REQUIRED' }, { status: 400 });
    }

    const actor = typeof body.actor === 'string' && body.actor ? `user:${body.actor}` : 'user:admin';

    const { data, error } = await supabaseAdmin.rpc('snooze_booking_task', {
      p_task_id: params.id,
      p_snoozed_until: until,
      p_actor: actor,
    });
    if (error) throw error;
    if (!data) {
      return apiResponse({ error: 'TASK_NOT_SNOOZABLE' }, { status: 409 });
    }

    return apiResponse({ task: data });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
