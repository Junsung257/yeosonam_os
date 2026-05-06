/**
 * Phase 3-F: 개별 항공편 상태 변경
 * PATCH /api/admin/flight-alerts/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'id 필수' }, { status: 400 });
  }

  try {
    const body = await request.json() as {
      status?: string;
      delayMinutes?: number;
      actualDeparture?: string;
      note?: string;
      notifiedCustomer?: boolean;
      notifiedOperator?: boolean;
    };

    const updatePayload: Record<string, unknown> = {};
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.delayMinutes !== undefined) updatePayload.delay_minutes = body.delayMinutes;
    if (body.actualDeparture !== undefined) updatePayload.actual_departure = body.actualDeparture;
    if (body.note !== undefined) updatePayload.note = body.note;
    if (body.notifiedCustomer !== undefined) updatePayload.notified_customer = body.notifiedCustomer;
    if (body.notifiedOperator !== undefined) updatePayload.notified_operator = body.notifiedOperator;

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
    }

    // 기존 레코드 조회 (알림에 필요한 정보)
    const { data: existing } = await supabaseAdmin
      .from('flight_alerts')
      .select('flight_number, route, scheduled_departure, status')
      .eq('id', id)
      .limit(1);

    const { error } = await supabaseAdmin
      .from('flight_alerts')
      .update(updatePayload)
      .eq('id', id);

    if (error) throw error;

    // 상태가 delayed/cancelled로 변경 시 Slack 알림
    const newStatus = body.status;
    if (newStatus === 'delayed' || newStatus === 'cancelled') {
      const flight = existing?.[0];
      const emoji = newStatus === 'cancelled' ? '🚫' : '⏰';
      const label = newStatus === 'cancelled' ? '취소' : `지연 ${body.delayMinutes ?? '?'}분`;
      await sendSlackAlert(
        `${emoji} 항공편 상태 변경 → ${label}: ${flight?.flight_number ?? id} (${flight?.route ?? ''})`,
        {
          flight_id: id,
          scheduled: flight?.scheduled_departure,
          previous_status: flight?.status,
          new_status: newStatus,
          note: body.note ?? null,
        },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '업데이트 실패' },
      { status: 500 },
    );
  }
}
