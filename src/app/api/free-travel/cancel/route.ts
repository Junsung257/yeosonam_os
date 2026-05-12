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
      error: '취소 기능은 Phase 1에서 활성화됩니다.',
      detail: '현재는 예약하신 플랫폼(마이리얼트립 등)에서 직접 취소해주세요.',
      phase: 1,
    },
    { status: 503 },
  );
}
