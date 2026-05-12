/**
 * POST /api/mrt/cancel
 *
 * MRT 예약 취소 스텁 — RESERVATIONS:WRITE 권한 보유 후 활성화.
 *
 * 현재: 503 반환 (권한 미보유).
 *
 * 활성화 시 구현할 내용:
 *   1. DELETE https://partner-ext-api.myrealtrip.com/v1/reservations/{reservationNo}
 *   2. 성공 시 free_travel_sessions.status = 'cancelled' 업데이트
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'RESERVATIONS:WRITE 권한 미보유. 마이리얼트립 파트너팀 권한 신청 후 활성화 가능합니다.',
      code:  'PERMISSION_NOT_GRANTED',
    },
    { status: 503 },
  );
}
