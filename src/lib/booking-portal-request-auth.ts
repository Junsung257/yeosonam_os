import type { NextRequest } from 'next/server';
import { BOOKING_PORTAL_SESSION_COOKIE, verifyBookingPortalSession } from '@/lib/booking-portal-session';
import { assertGuestPortalTokenRowActive } from '@/lib/booking-guest-token';

export async function getBookingPortalSessionFromRequest(
  request: NextRequest,
): Promise<{ bookingId: string; tokenRowId: string } | null> {
  const raw = request.cookies.get(BOOKING_PORTAL_SESSION_COOKIE)?.value;
  if (!raw?.trim()) return null;
  const payload = verifyBookingPortalSession(raw.trim());
  if (!payload) return null;
  const ok = await assertGuestPortalTokenRowActive(payload.tid, payload.bid);
  if (!ok) return null;
  return { bookingId: payload.bid, tokenRowId: payload.tid };
}
