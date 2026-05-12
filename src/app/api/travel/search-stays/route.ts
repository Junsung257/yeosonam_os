import { NextRequest, NextResponse } from 'next/server';
import { aggregator } from '@/lib/travel-providers';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword  = searchParams.get('keyword');
  const checkIn  = searchParams.get('checkIn');
  const checkOut = searchParams.get('checkOut');
  const adults   = parseInt(searchParams.get('adults') ?? '2', 10);
  const children = parseInt(searchParams.get('children') ?? '0', 10);

  if (!keyword || !checkIn || !checkOut) {
    return NextResponse.json({ error: 'keyword, checkIn, checkOut 필수' }, { status: 400 });
  }

  try {
    const result = await aggregator.searchStays({ destination: keyword, checkIn, checkOut, adults, children });
    return NextResponse.json({ results: result.results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '검색 실패' }, { status: 500 });
  }
}
