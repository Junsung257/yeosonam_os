import crypto from 'crypto';
import { getSecret } from '@/lib/secret-registry';

export interface GuidebookTokenPayload {
  bookingId: string;
  voucherId?: string | null;
  sessionId?: string | null;
  exp: number;
  scope: 'guide:read';
}

function guidebookHmacSecret() {
  return getSecret('GUIDEBOOK_TOKEN_SECRET') || getSecret('SUPABASE_SERVICE_ROLE_KEY') || 'dev-guidebook-secret';
}

function encodeBase64Url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signGuidebookToken(input: {
  bookingId: string;
  voucherId?: string | null;
  sessionId?: string | null;
  expiresInSeconds?: number;
}) {
  const payload: GuidebookTokenPayload = {
    bookingId: input.bookingId,
    voucherId: input.voucherId ?? null,
    sessionId: input.sessionId ?? null,
    exp: Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 60 * 60 * 24 * 14),
    scope: 'guide:read',
  };
  const body = encodeBase64Url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', guidebookHmacSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyGuidebookToken(token: string): GuidebookTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', guidebookHmacSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(body)) as GuidebookTokenPayload;
    if (payload.scope !== 'guide:read') return null;
    if (!payload.bookingId) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
