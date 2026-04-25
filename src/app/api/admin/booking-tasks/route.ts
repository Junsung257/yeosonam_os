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

    // Inbox 목록
    const { data: tasks, error: taskErr } = await supabaseAdmin.rpc('get_inbox_tasks', {
      p_priority_max: priorityMax,
      p_limit: limit,
      p_offset: offset,
    });
    if (taskErr) throw taskErr;

    // 헬스 요약
    const { data: healthRows } = await supabaseAdmin
      .from('booking_tasks_health')
      .select('*')
      .limit(1);

    // 미매칭 입금 배너 (booking_tasks 와 별도 소스)
    const { data: bankHealth } = await supabaseAdmin
      .from('bank_tx_health')
      .select('unmatched_count, review_count, error_count, stale_over_24h')
      .limit(1);

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
