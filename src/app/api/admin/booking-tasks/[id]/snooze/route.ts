/**
 * POST /api/admin/booking-tasks/:id/snooze
 *   "나중에" 버튼 → status='snoozed' + snoozed_until
 *
 * Body: { snoozed_until: ISO string, actor?: string }
 *   OR  { hours: number, actor?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { validateRequest } from '@/lib/api-validation';

const SnoozeBodySchema = z
  .object({
    snoozed_until: z.string().datetime({ message: 'ISO 8601 datetime이어야 합니다' }).optional(),
    hours: z.number().positive().optional(),
    actor: z.string().min(1).optional(),
  })
  .refine(d => d.snoozed_until !== undefined || d.hours !== undefined, {
    message: 'snoozed_until 또는 hours 중 하나가 필요합니다',
  });

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const validation = await validateRequest(request, SnoozeBodySchema);
  if (!validation.success) return validation.response;
  const { snoozed_until, hours, actor: actorInput } = validation.data;

  try {
    const until = snoozed_until
      ? new Date(snoozed_until).toISOString()
      : new Date(Date.now() + (hours as number) * 60 * 60 * 1000).toISOString();

    const actor = actorInput ? `user:${actorInput}` : 'user:admin';

    const { data, error } = await supabaseAdmin.rpc('snooze_booking_task', {
      p_task_id:       params.id,
      p_snoozed_until: until,
      p_actor:         actor,
    });
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: '이미 닫혔거나 스누즈 불가능한 Task (open 상태만 가능)' },
        { status: 409 },
      );
    }

    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'snooze 실패' },
      { status: 500 },
    );
  }
}
