/**
 * GET /api/products/flight-schedule
 *
 * 랜드사 상품의 항공 스케줄을 MRT에서 실시간 조회.
 * 어드민 상품 검수 페이지에서 "최신 스케줄 확인" 버튼에 사용.
 *
 * 조회 결과는 products.flight_info 에 저장하여 A4·모바일에 표시.
 *
 * 쿼리: ?departure=PUS&destination=DAD&date=2026-05-07&flightNo=OZ761
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlightSchedule } from '@/lib/travel-providers/mrt';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const departure    = searchParams.get('departure');
  const destination  = searchParams.get('destination');
  const date         = searchParams.get('date');
  const flightNo     = searchParams.get('flightNo') ?? undefined;

  if (!departure || !destination || !date) {
    return NextResponse.json({ error: 'departure, destination, date 필수' }, { status: 400 });
  }

  try {
    const schedule = await getFlightSchedule(departure, destination, date, flightNo);
    if (!schedule) {
      return NextResponse.json({ error: '스케줄 정보를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ schedule }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
