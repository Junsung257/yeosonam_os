import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const Schema = z.object({
  sessionId: z.string().uuid(),
  mrtBookingRef: z.string().min(1),
  bookedBy: z.string().optional(),
  status: z.enum(['contacted', 'booked', 'cancelled']).default('booked'),
  adminNotes: z.string().optional(),
});

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = Schema.parse(await request.json());

    const updatePayload: Record<string, unknown> = {
      status: body.status,
      mrt_booking_ref: body.mrtBookingRef,
      booked_by: body.bookedBy ?? '관리자',
      booked_at: new Date().toISOString(),
    };
    if (body.adminNotes !== undefined) updatePayload.admin_notes = body.adminNotes;

    const { error } = await supabaseAdmin
      .from('free_travel_sessions')
      .update(updatePayload)
      .eq('id', body.sessionId);

    if (error) {
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        return apiResponse(
          { error: 'DB 마이그레이션 필요. supabase/migrations/20260502100000_free_travel_sessions_v2.sql 실행 후 재시도.' },
          { status: 503 },
        );
      }
      throw error;
    }

    return apiResponse({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return apiResponse({ error: err.errors[0]?.message ?? '입력 오류' }, { status: 400 });
    }
    return apiResponse({ error: sanitizeDbError(err, '처리 실패') }, { status: 500 });
  }
}
