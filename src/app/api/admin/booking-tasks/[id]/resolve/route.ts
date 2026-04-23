/**
 * POST /api/admin/booking-tasks/:id/resolve
 *   운영자 "완료" 버튼 → status='resolved'
 *
 * Body: { resolution?: string, actor?: string }
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
    const resolution = typeof body.resolution === 'string' ? body.resolution : 'manual';
    const actor      = typeof body.actor === 'string' && body.actor ? `user:${body.actor}` : 'user:admin';

    const { data, error } = await supabaseAdmin.rpc('resolve_booking_task', {
      p_task_id:     params.id,
      p_resolved_by: actor,
      p_resolution:  resolution,
    });
    if (error) throw error;

    // RPC 는 row 반환 — null/undefined 면 이미 닫혔거나 없는 Task
    if (!data) {
      return NextResponse.json(
        { error: '이미 닫혔거나 존재하지 않는 Task' },
        { status: 404 },
      );
    }

    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'resolve 실패' },
      { status: 500 },
    );
  }
}
