/**
 * GET /api/free-travel/tna-detail
 *
 * 투어/액티비티 상세 정보 실시간 조회 (MRT getTnaDetail).
 * 자유여행 플래너 액티비티 카드 "상세보기"에서 호출.
 *
 * Query: ?gid=abc123&url=https://myrealtrip.com/offers/xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTnaDetail } from '@/lib/travel-providers/mrt';

const QuerySchema = z.object({
  gid: z.string().min(1),
  url: z.string().url(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    gid: searchParams.get('gid') ?? '',
    url: searchParams.get('url') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'gid/url 값을 확인해주세요.' }, { status: 400 });
  }
  const { gid, url } = parsed.data;
  const host = new URL(url).hostname;
  if (!host.endsWith('myrealtrip.com')) {
    return NextResponse.json({ code: 'INVALID_URL_HOST', error: '허용되지 않은 URL입니다.' }, { status: 400 });
  }

  try {
    const detail = await getTnaDetail(gid, url);
    if (!detail) {
      return NextResponse.json({ error: '투어 상세 정보를 가져올 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ detail }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    return NextResponse.json(
      { code: 'TNA_DETAIL_FAILED', error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
