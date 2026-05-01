import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFareCalendar } from '@/lib/travel-providers/mrt';

const QuerySchema = z.object({
  from: z.string().regex(/^[A-Z]{3}$/),
  to: z.string().regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nights: z.number().int().min(1).max(60),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    date: searchParams.get('date') ?? new Date().toISOString().slice(0, 10),
    nights: Number(searchParams.get('nights') ?? '4'),
  });

  if (!parsed.success) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: '출발지/목적지(IATA)와 날짜 형식을 확인해주세요.' }, { status: 400 });
  }
  const { from, to, date, nights } = parsed.data;

  try {
    const entries = await getFareCalendar(from, to, date, nights, 90);
    return NextResponse.json({ entries }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    return NextResponse.json(
      { code: 'FARE_CALENDAR_FAILED', error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
