import { NextResponse } from 'next/server';
import {
  getRecognizedRevenueMonthly,
  getNewBookingsMonthly,
  getBookingPaceAndCancellation,
  isSupabaseConfigured,
} from '@/lib/supabase';

/**
 * Dashboard V4 — 매출 인식 분리 (IFRS 15 / ASC 606) + Booking Pace
 *  - recognized: 출발일 기준 확정매출 (회계, 사장님 요구 #1)
 *  - newBookings: 생성일 KST 기준 신규예약 + 취소율 (영업, 사장님 요구 #2)
 *  - paceAndCancellation: D-N 버킷별 향후 출발 + 90일 취소율 (Booking.com 표준)
 */
export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ recognized: [], newBookings: [], pace: [], cancellation_90d: null });
  }
  const { searchParams } = new URL(request.url);
  const months = Math.min(24, Math.max(1, parseInt(searchParams.get('months') || '6', 10)));

  try {
    const [recognized, newBookings, paceAndCancel] = await Promise.all([
      getRecognizedRevenueMonthly(months),
      getNewBookingsMonthly(months),
      getBookingPaceAndCancellation(),
    ]);
    return NextResponse.json({
      recognized,
      newBookings,
      pace: paceAndCancel.pace,
      cancellation_90d: paceAndCancel.cancellation_90d,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '대시보드 V4 조회 실패' },
      { status: 500 },
    );
  }
}
