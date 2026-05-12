/**
 * POST /api/mrt/booking
 *
 * MRT 예약 생성 스텁 — RESERVATIONS:WRITE 권한 보유 후 활성화.
 *
 * 현재: 503 반환 (권한 미보유).
 * 활성화 조건: marketing_partner@myrealtrip.com 에 RESERVATIONS:WRITE 신청 후 승인.
 *
 * 활성화 시 구현할 내용:
 *   1. POST https://partner-ext-api.myrealtrip.com/v1/reservations
 *   2. Body: { gid, options, participants, paymentMethod }
 *   3. 성공 시 free_travel_sessions.mrt_booking_ref = reservationNo 업데이트
 *   4. 세션 status = 'booked' 업데이트
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'RESERVATIONS:WRITE 권한 미보유. 마이리얼트립 파트너팀(marketing_partner@myrealtrip.com) 에 권한 신청 후 활성화 가능합니다.',
      code:  'PERMISSION_NOT_GRANTED',
    },
    { status: 503 },
  );
}
