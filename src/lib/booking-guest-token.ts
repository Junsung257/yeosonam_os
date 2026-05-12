/**
 * 고객용 예약 포털 토큰 — 원문은 응답/알림에만 1회 노출, DB에는 SHA-256만 저장.
 */

import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { guestPortalTokenTtlDays } from '@/lib/booking-automation-policy';

export function hashGuestPortalToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function buildGuestPortalUrl(rawToken: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) {
    console.warn('[guest-portal] NEXT_PUBLIC_BASE_URL 미설정 — 상대경로만 반환');
    return `/trip/${rawToken}`;
  }
  return `${base}/trip/${rawToken}`;
}

export async function mintGuestPortalToken(bookingId: string): Promise<{ rawToken: string; portalUrl: string; expiresAt: string }> {
  const rawToken = generateRawToken();
  const tokenHash = hashGuestPortalToken(rawToken);
  const ttlDays = guestPortalTokenTtlDays();
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();

  const { error } = await supabaseAdmin.from('booking_guest_tokens').insert({
    booking_id: bookingId,
    token_hash: tokenHash,
    purpose: 'customer_portal',
    expires_at: expiresAt,
  } as never);

  if (error) throw new Error(error.message);

  return { rawToken, portalUrl: buildGuestPortalUrl(rawToken), expiresAt };
}

export async function resolveGuestPortalBookingId(rawToken: string): Promise<{
  bookingId: string;
  tokenRowId: string;
  tokenExpiresAt: string;
} | null> {
  const tokenHash = hashGuestPortalToken(rawToken.trim());
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('booking_guest_tokens')
    .select('id, booking_id, expires_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as { booking_id: string; id: string; expires_at: string };
  return { bookingId: row.booking_id, tokenRowId: row.id, tokenExpiresAt: row.expires_at };
}

/** 세션 쿠키 검증 후 DB에서 토큰 행이 여전히 유효한지 확인 */
export async function assertGuestPortalTokenRowActive(
  tokenRowId: string,
  bookingId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('booking_guest_tokens')
    .select('id')
    .eq('id', tokenRowId)
    .eq('booking_id', bookingId)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function touchGuestPortalToken(tokenRowId: string): Promise<void> {
  await supabaseAdmin
    .from('booking_guest_tokens')
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq('id', tokenRowId);
}
