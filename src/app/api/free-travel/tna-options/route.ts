/**
 * GET /api/free-travel/tna-options
 *
 * 투어/액티비티 날짜별 옵션/가격/재고 실시간 조회 (MRT getTnaOptions).
 * 예약 직전 단계에서 날짜 선택 시 호출.
 *
 * Query: ?gid=abc123&url=https://myrealtrip.com/offers/xxx&date=2026-06-15
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTnaOptions } from '@/lib/travel-providers/mrt';

const QuerySchema = z.object({
  gid: z.string().min(1),
  url: z.string().url(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    gid: searchParams.get('gid') ?? '',
    url: searchParams.get('url') ?? '',
    date: searchParams.get('date') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'gid/url/date 값을 확인해주세요.' }, { status: 400 });
  }
  const { gid, url, date } = parsed.data;
  const host = new URL(url).hostname;
  if (!host.endsWith('myrealtrip.com')) {
    return NextResponse.json({ code: 'INVALID_URL_HOST', error: '허용되지 않은 URL입니다.' }, { status: 400 });
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ code: 'PAST_DATE_NOT_ALLOWED', error: '과거 날짜는 조회할 수 없습니다.' }, { status: 400 });
  }

  try {
    const options = await getTnaOptions(gid, url, date);
    return NextResponse.json({ options }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { code: 'TNA_OPTIONS_FAILED', error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
