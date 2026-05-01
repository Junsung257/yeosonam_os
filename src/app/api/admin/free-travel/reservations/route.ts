/**
 * GET /api/admin/free-travel/reservations
 *
 * MRT RESERVATIONS:READ API로 예약 내역 자동 조회.
 * utm_content(세션 ID) 기반으로 free_travel_sessions 자동 매칭 후
 * 매칭된 세션의 status를 'booked'로 업데이트.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMrtReservations } from '@/lib/mrt-partner-api';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const startDate      = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const endDate        = searchParams.get('to')   ?? new Date().toISOString().slice(0, 10);
  const page           = Number(searchParams.get('page') ?? 1);
  const dateSearchType = (searchParams.get('dateSearchType') ?? 'RESERVATION_DATE') as 'RESERVATION_DATE' | 'TRIP_END_DATE';
  const statusParam    = searchParams.get('status');
  const statuses       = statusParam ? statusParam.split(',') : undefined;
  const sync           = searchParams.get('sync') === '1'; // sync=1 이면 세션 상태 업데이트

  try {
    const reservations = await getMrtReservations({ startDate, endDate, dateSearchType, statuses, page, pageSize: 50 });

    if (!reservations) {
      return NextResponse.json({ error: 'MRT API 조회 실패. API Key를 확인하세요.' }, { status: 502 });
    }

    // utmContent(세션 ID) 있는 건만 자동 매칭 + DB 업데이트
    if (sync && isSupabaseConfigured && supabaseAdmin) {
      const toBook = reservations.items.filter(r => r.utmContent && r.status === 'confirmed');
      for (const r of toBook) {
        await supabaseAdmin
          .from('free_travel_sessions')
          .update({
            mrt_booking_ref: r.reservationNo,
            booked_at:       new Date().toISOString(),
            booked_by:       'mrt-auto',
            status:          'booked',
          })
          .eq('id', r.utmContent!)
          .in('status', ['new', 'contacted']);
      }
    }

    return NextResponse.json({
      items:      reservations.items,
      totalCount: reservations.totalCount,
      page:       reservations.page,
      from:       startDate,
      to:         endDate,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '처리 실패' }, { status: 500 });
  }
}
