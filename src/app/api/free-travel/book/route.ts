/**
 * POST /api/free-travel/book — Phase 1 Skeleton
 *
 * 자유여행 예약 처리 (Phase 1에서 활성화).
 * 현재: Phase 1 안내 메시지만 반환.
 *
 * Phase 1 구현 요건:
 * - MRT RESERVATIONS:WRITE 파트너 권한 승인
 * - free_travel_bookings + free_travel_booking_items 테이블 활성
 * - provider.createBooking() 구현
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      code: 'FEATURE_NOT_ENABLED',
      feature: 'free_travel_direct_booking',
      error: '여소남 자유여행 직접 예약은 아직 제공하지 않습니다.',
      message: '항공·숙소·액티비티는 마이리얼트립 또는 해당 예약처에서 최종 날짜·인원을 확인한 뒤 예약해 주세요.',
      details: {
        reason: 'MRT RESERVATIONS:WRITE 파트너 권한과 provider.createBooking() 구현 전입니다.',
        alternatives: ['mrt_external_booking', 'yeosonam_package_consultation', 'manual_follow_up'],
      },
      phase: 1,
    },
    { status: 503 },
  );
}
