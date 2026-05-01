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
      error: '예약 기능은 Phase 1에서 활성화됩니다.',
      detail: 'MRT RESERVATIONS:WRITE 파트너 권한 승인 대기 중. 현재는 MRT 사이트에서 직접 예약해주세요.',
      phase: 1,
    },
    { status: 503 },
  );
}
