import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { logError } from '@/lib/sentry-logger';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const postHandler = async (
  request: NextRequest,
  { params }: { params: { id: string } },
) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    const { id } = params;
    let body: { dispute_flag?: unknown; dispute_note?: unknown };
    try {
      body = await request.json();
    } catch {
      return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const { dispute_flag, dispute_note } = body;
    if (typeof dispute_flag !== 'boolean') {
      return apiResponse({ error: 'DISPUTE_FLAG_REQUIRED' }, { status: 400 });
    }

    const note = typeof dispute_note === 'string' ? dispute_note : null;
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({
        dispute_flag,
        dispute_note: note || null,
      })
      .eq('id', id)
      .select('id, dispute_flag, dispute_note')
      .single();

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      action: dispute_flag ? 'DISPUTE_FLAG_ON' : 'DISPUTE_FLAG_OFF',
      target_type: 'booking',
      target_id: id,
      description: dispute_flag
        ? 'dispute flag set'
        : 'dispute flag cleared',
    });

    return apiResponse({ booking: data });
  } catch (error) {
    logError('[admin/bookings/dispute] flag toggle failed', error);
    return apiResponse(
      { error: logAndSanitize('admin-bookings-dispute', error, 'REQUEST_FAILED') },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
