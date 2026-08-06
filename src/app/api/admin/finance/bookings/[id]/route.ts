import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { loadFinanceBookingReviewDetail } from '@/lib/finance-settlement-v3-service';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const { id } = await context.params;
    const booking = await loadFinanceBookingReviewDetail(id);
    if (!booking) return NextResponse.json({ error: '예약을 찾지 못했습니다.' }, { status: 404 });
    return NextResponse.json({ booking }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '예약 정산 상세를 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
