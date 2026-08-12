import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const month = request.nextUrl.searchParams.get('month');
    const status = request.nextUrl.searchParams.get('status');
    const query = request.nextUrl.searchParams.get('q');
    const includeExcluded = request.nextUrl.searchParams.get('includeExcluded') === 'true';
    const sort = request.nextUrl.searchParams.get('sort') === 'departure_asc'
      ? 'departure_asc'
      : 'departure_desc';
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: '출발 월은 YYYY-MM 형식이어야 합니다.' }, { status: 400 });
    }
    type ReviewFilters = NonNullable<Parameters<typeof loadFinanceBookingReviews>[0]>;
    const result = await loadFinanceBookingReviews({
      month,
      status: status as ReviewFilters['status'],
      query,
      includeExcluded,
      sort,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '예약별 정산을 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
