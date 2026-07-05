/**
 * POST /api/free-travel/cancel — Phase 1 Skeleton
 *
 * 자유여행 예약 취소 처리 (Phase 1에서 활성화).
 * Phase 0: 고객이 MRT 사이트에서 직접 취소 (여소남 개입 없음).
 * Phase 1: provider.cancelBooking() 호출 + 부분 취소 지원.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      code: 'FEATURE_NOT_ENABLED',
      feature: 'free_travel_direct_cancel',
      error: '여소남 자유여행 직접 취소는 아직 제공하지 않습니다.',
      message: '마이리얼트립 또는 항공사 등 실제 예약을 완료한 플랫폼에서 취소·환불을 진행해 주세요.',
      details: {
        reason: 'provider.cancelBooking() 구현 전이며, 여소남이 자유여행 결제·예약번호를 보유하지 않습니다.',
        alternatives: ['provider_external_cancel', 'manual_follow_up'],
      },
      phase: 1,
    },
    { status: 503 },
  );
}
