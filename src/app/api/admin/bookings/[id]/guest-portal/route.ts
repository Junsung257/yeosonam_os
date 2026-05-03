import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { mintGuestPortalToken } from '@/lib/booking-guest-token';

/**
 * POST — 고객용 예약 요약 링크 발급 (어드민 전용)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const req = _request;
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { id: bookingId } = await params;

  const { data: row, error } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
  }

  try {
    const { portalUrl, expiresAt } = await mintGuestPortalToken(bookingId);
    return NextResponse.json({ portalUrl, expiresAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '토큰 발급 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
