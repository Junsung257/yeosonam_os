/**
 * GET /api/free-travel/stay-detail
 *
 * 숙소 상세 정보 실시간 조회 (MRT getStayDetail).
 * 자유여행 플래너 호텔 카드 "상세보기"에서 호출.
 *
 * Query: ?gid=12345&checkIn=2026-06-01&checkOut=2026-06-03&adults=2&children=0
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStayDetail } from '@/lib/travel-providers/mrt';

const QuerySchema = z.object({
  gid: z.string().min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(8),
  children: z.number().int().min(0).max(6),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    gid: searchParams.get('gid') ?? '',
    checkIn: searchParams.get('checkIn') ?? '',
    checkOut: searchParams.get('checkOut') ?? '',
    adults: Number(searchParams.get('adults') ?? '2'),
    children: Number(searchParams.get('children') ?? '0'),
  });

  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'gid/checkIn/checkOut/adults/children 값을 확인해주세요.' }, { status: 400 });
  }
  const { gid, checkIn, checkOut, adults, children } = parsed.data;

  try {
    const detail = await getStayDetail(gid, checkIn, checkOut, adults, children);
    if (!detail) {
      return NextResponse.json({ error: '숙소 상세 정보를 가져올 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ detail }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    return NextResponse.json(
      { code: 'STAY_DETAIL_FAILED', error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
