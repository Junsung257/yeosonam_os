/**
 * 예약 포털 게스트 세션 — httpOnly 쿠키(HMAC). Supabase 로그인 없이 booking_id 스코프만 부여.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const BOOKING_PORTAL_SESSION_COOKIE = 'yn_bp_sess';

const COOKIE_MAX_SEC = 48 * 60 * 60; // 상한 48h (실제 만료는 토큰 행·페이로드 exp와 교차)

export type BookingPortalSessionPayload = {
  /** bookings.id */
  bid: string;
  /** booking_guest_tokens.id */
  tid: string;
  /** unix seconds */
  exp: number;
};

function sessionSecret(): string {
  const s =
    process.env.GUEST_PORTAL_SESSION_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    (process.env.NODE_ENV !== 'production' ? 'dev-guest-portal-session-insecure' : '');
  return s;
}

export function isBookingPortalSessionConfigured(): boolean {
  return Boolean(sessionSecret());
}

export function signBookingPortalSession(payload: BookingPortalSessionPayload): string {
  const secret = sessionSecret();
  if (!secret) throw new Error('GUEST_PORTAL_SESSION_SECRET 또는 CRON_SECRET 필요');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyBookingPortalSession(token: string): BookingPortalSessionPayload | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const p = JSON.parse(json) as BookingPortalSessionPayload;
    if (!p?.bid || !p?.tid || typeof p.exp !== 'number') return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Set-Cookie maxAge (초): 페이로드 exp와 COOKIE_MAX_SEC 중 작은 값 */
export function cookieMaxAgeSec(sessionExp: number): number {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, sessionExp - now);
  return Math.min(ttl, COOKIE_MAX_SEC);
}
