/**
 * GET /api/travel/tna-categories
 *
 * 도시별 투어/액티비티 카테고리 목록 조회 (MRT getCategoryList).
 * from-mrt 어드민 페이지 카테고리 필터에서 사용.
 *
 * Query: ?city=다낭
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCategoryList } from '@/lib/travel-providers/mrt';

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get('city');

  if (!city) {
    return NextResponse.json({ error: 'city 필수' }, { status: 400 });
  }

  try {
    const categories = await getCategoryList(city);
    return NextResponse.json({ categories }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
