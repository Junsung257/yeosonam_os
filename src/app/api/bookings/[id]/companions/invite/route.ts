import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * POST /api/bookings/:id/companions/invite
 *
 * 대표 예약자가 동행자 초대 링크를 생성한다.
 *
 * Body: { count: number }  — 생성할 동행자 수 (1~10)
 *
 * Response:
 * {
 *   links: [
 *     { token: 'abc123...', url: 'https://.../join/abc123...' },
 *     ...
 *   ]
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const bookingId = params.id;
    const body = await request.json().catch(() => ({}));
    const count = Math.min(10, Math.max(1, Number(body?.count ?? 1)));

    // ── 예약 존재 여부 확인 ──────────────────────────────────
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('id', bookingId)
      .limit(1);

    if (bookingError) throw bookingError;
    if (!booking || booking.length === 0) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }

    // ── 동행자 레코드 생성 ────────────────────────────────────
    const rows = Array.from({ length: count }, () => ({
      booking_id: bookingId,
    }));

    const { data: companions, error: insertError } = await supabaseAdmin
      .from('booking_companions')
      .insert(rows)
      .select('id, invite_token');

    if (insertError) throw insertError;

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

    const links = (companions ?? []).map((c: { id: string; invite_token: string }) => ({
      token: c.invite_token,
      url: `${baseUrl}/join/${c.invite_token}`,
    }));

    return NextResponse.json({ links });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
