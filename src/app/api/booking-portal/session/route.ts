import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveGuestPortalBookingId, touchGuestPortalToken } from '@/lib/booking-guest-token';
import {
  BOOKING_PORTAL_SESSION_COOKIE,
  cookieMaxAgeSec,
  isBookingPortalSessionConfigured,
  signBookingPortalSession,
} from '@/lib/booking-portal-session';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: '서버 설정 오류입니다.' }, { status: 503 });
  }
  if (!isBookingPortalSessionConfigured()) {
    return apiResponse({ error: '게스트 포털 세션 설정이 필요합니다.' }, { status: 503 });
  }

  const ip = getClientIpFromRequest(request);
  if (!allowRateLimit(`bp_session:${ip}`, 30, 60_000)) {
    return apiResponse({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return apiResponse({ error: 'token은 필수입니다.' }, { status: 400 });
  }

  const resolved = await resolveGuestPortalBookingId(token);
  if (!resolved) {
    return apiResponse({ error: '유효하지 않거나 만료된 링크입니다.' }, { status: 401 });
  }

  await touchGuestPortalToken(resolved.tokenRowId).catch((error) => {
    console.warn('[booking-portal/session] touch failed:', sanitizeDbError(error));
  });

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
  } catch (error) {
    console.error('[booking-portal/session] sign failed:', sanitizeDbError(error));
    return apiResponse({ error: '세션 발급에 실패했습니다.' }, { status: 500 });
  }

  const res = apiResponse({ ok: true });
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
