import { NextRequest, NextResponse } from 'next/server';
import { aggregator } from '@/lib/travel-providers';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const destination = searchParams.get('destination');
  const limit       = parseInt(searchParams.get('limit') ?? '20', 10);
  const category    = searchParams.get('category') ?? undefined;

  if (!destination) {
    return NextResponse.json({ error: 'destination 필수' }, { status: 400 });
  }

  try {
    const result = await aggregator.searchActivities({ destination, limit, category });
    return NextResponse.json({ results: result.results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '검색 실패' }, { status: 500 });
  }
}
