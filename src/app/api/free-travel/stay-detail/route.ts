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
  /** MRT 숙소 gid는 숫자. 추정/폴백 숙소 ID는 상세 조회 불가 */
  gid: z.string().regex(/^\d+$/),
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
    return NextResponse.json({
      code: 'VALIDATION_ERROR',
      error: '숙소 상세는 마이리얼트립에서 조회된 숙소(숫자 ID)에서만 열립니다. 추정 호텔은 목적지·날짜로 마이리얼트립에서 직접 검색해 주세요.',
    }, { status: 400 });
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
