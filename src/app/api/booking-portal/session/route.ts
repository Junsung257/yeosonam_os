import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { resolveGuestPortalBookingId, touchGuestPortalToken } from '@/lib/booking-guest-token';
import {
  BOOKING_PORTAL_SESSION_COOKIE,
  cookieMaxAgeSec,
  isBookingPortalSessionConfigured,
  signBookingPortalSession,
} from '@/lib/booking-portal-session';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 503 });
  }
  if (!isBookingPortalSessionConfigured()) {
    return NextResponse.json(
      { error: 'GUEST_PORTAL_SESSION_SECRET 또는 CRON_SECRET을 설정해 주세요.' },
      { status: 503 },
    );
  }

  const ip = getClientIpFromRequest(request);
  if (!allowRateLimit(`bp_session:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'token이 필요합니다.' }, { status: 400 });
  }

  const resolved = await resolveGuestPortalBookingId(token);
  if (!resolved) {
    return NextResponse.json({ error: '유효하지 않거나 만료된 링크입니다.' }, { status: 401 });
  }

  await touchGuestPortalToken(resolved.tokenRowId).catch(() => {});

  const tokenExpMs = new Date(resolved.tokenExpiresAt).getTime();
  const capMs = Math.min(tokenExpMs, Date.now() + 48 * 60 * 60 * 1000);
  const exp = Math.floor(capMs / 1000);

  let signed: string;
  try {
    signed = signBookingPortalSession({
      bid: resolved.bookingId,
      tid: resolved.tokenRowId,
      exp,
    });
  } catch (e) {
    console.error('[booking-portal/session]', e);
    return NextResponse.json({ error: '세션 발급 실패' }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  const isSecure = process.env.NODE_ENV === 'production';
  res.cookies.set(BOOKING_PORTAL_SESSION_COOKIE, signed, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: cookieMaxAgeSec(exp),
  });
  return res;
}
