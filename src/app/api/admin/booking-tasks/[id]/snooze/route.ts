/**
 * POST /api/admin/booking-tasks/:id/snooze
 *   "나중에" 버튼 → status='snoozed' + snoozed_until
 *
 * Body: { snoozed_until: ISO string, actor?: string }
 *   OR  { hours: number, actor?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    let until: string | null = null;

    if (typeof body.snoozed_until === 'string') {
      const parsed = new Date(body.snoozed_until);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'invalid snoozed_until' }, { status: 400 });
      }
      until = parsed.toISOString();
    } else if (typeof body.hours === 'number' && body.hours > 0) {
      until = new Date(Date.now() + body.hours * 60 * 60 * 1000).toISOString();
    } else {
      return NextResponse.json(
        { error: 'snoozed_until 또는 hours 중 하나가 필요합니다' },
        { status: 400 },
      );
    }

    const actor = typeof body.actor === 'string' && body.actor ? `user:${body.actor}` : 'user:admin';

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
