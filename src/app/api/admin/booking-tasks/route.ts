/**
 * GET /api/admin/booking-tasks
 *   Inbox 목록 조회. get_inbox_tasks RPC 사용 → booking/customer 필드 JOIN 포함
 *
 * Query:
 *   priority_max   : 0~3 (기본 3=전체)
 *   limit, offset  : 페이지네이션
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ tasks: [], health: null }, { status: 200 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const priorityMax = Math.min(3, Math.max(0, Number(searchParams.get('priority_max') ?? '3')));
    const limit       = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '100')));
    const offset      = Math.max(0, Number(searchParams.get('offset') ?? '0'));

    // Inbox + 헬스 + 입금 배너 병렬 조회 (서로 독립)
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
    const tasks = tasksRes.data;
    const healthRows = healthRes.data;
    const bankHealth = bankRes.data;

    return NextResponse.json({
      tasks: tasks ?? [],
      health: healthRows?.[0] ?? null,
      bank_health: bankHealth?.[0] ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Inbox 조회 실패' },
      { status: 500 },
    );
  }
}
