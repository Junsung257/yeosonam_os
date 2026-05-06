/**
 * Phase 3-F: 항공 상태 관리 API
 *
 * GET  /api/admin/flight-alerts  — 오늘·내일 출발 항공편 목록
 * POST /api/admin/flight-alerts  — 새 항공편 등록 + 지연/취소 시 Slack 알림
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const dynamic = 'force-dynamic';

function todayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 2);
  end.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ flights: [] });
  }

  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  if (!userData?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const { start, end } = todayRange();

    const { data, error } = await supabaseAdmin
      .from('flight_alerts')
      .select('*')
      .gte('scheduled_departure', start)
      .lt('scheduled_departure', end)
      .order('scheduled_departure', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ flights: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const tokenPost =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userDataPost } = await supabaseAdmin.auth.getUser(tokenPost ?? '');
  if (!userDataPost?.user?.id) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      bookingId?: string;
      flightNumber: string;
      route: string;
      scheduledDeparture: string;
      status?: string;
      delayMinutes?: number;
      actualDeparture?: string;
      note?: string;
    };

    const {
      bookingId,
      flightNumber,
      route,
      scheduledDeparture,
      status = 'scheduled',
      delayMinutes,
      actualDeparture,
      note,
    } = body;

    if (!flightNumber || !route || !scheduledDeparture) {
      return NextResponse.json(
        { error: 'flightNumber, route, scheduledDeparture 필수' },
        { status: 400 },
      );
    }

    const insertPayload: Record<string, unknown> = {
      flight_number: flightNumber,
      route,
      scheduled_departure: scheduledDeparture,
      status,
      delay_minutes: delayMinutes ?? null,
      actual_departure: actualDeparture ?? null,
      note: note ?? null,
    };
    if (bookingId) insertPayload.booking_id = bookingId;

    const { data, error } = await supabaseAdmin
      .from('flight_alerts')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) throw error;

    // 지연/취소 등록 시 Slack 즉시 알림
    if (status === 'delayed' || status === 'cancelled') {
      const emoji = status === 'cancelled' ? '🚫' : '⏰';
      const label = status === 'cancelled' ? '취소' : `지연 ${delayMinutes ?? '?'}분`;
      await sendSlackAlert(
        `${emoji} 항공편 ${label}: ${flightNumber} (${route})`,
        {
          flight_id: data?.id,
          scheduled: scheduledDeparture,
          note: note ?? null,
        },
      );
    }

    return NextResponse.json({ ok: true, flight_id: data?.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '등록 실패' },
      { status: 500 },
    );
  }
}
