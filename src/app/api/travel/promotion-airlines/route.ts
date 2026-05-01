/**
 * GET /api/travel/promotion-airlines
 *
 * 현재 프로모션 항공사 목록 조회 (MRT getPromotionAirlines).
 * 자유여행 플래너 idle 화면 및 홈 배너에서 사용.
 * 1시간 캐시.
 */

import { NextResponse } from 'next/server';
import { getPromotionAirlines } from '@/lib/travel-providers/mrt';

export async function GET() {
  try {
    const airlines = await getPromotionAirlines();
    return NextResponse.json({ airlines }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
