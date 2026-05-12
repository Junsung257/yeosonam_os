import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';

const SID_COOKIE = 'aff_sid';
const SID_MAX_AGE = 30 * 24 * 60 * 60;

export function getOrCreateAffiliateSid(
  request: NextRequest,
  response: NextResponse,
): { sid: string; isNew: boolean } {
  const existing = request.cookies.get(SID_COOKIE)?.value;
  if (existing) return { sid: existing, isNew: false };

  const sid = crypto.randomUUID();
  response.cookies.set(SID_COOKIE, sid, {
    maxAge: SID_MAX_AGE,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  return { sid, isNew: true };
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = getSecret('AFFILIATE_IP_SALT') ?? 'yeosonam-fallback-salt';
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update(`${ip}|${salt}|${day}`)
    .digest('hex')
    .slice(0, 32);
}

export function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

export function getClientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
