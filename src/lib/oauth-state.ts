import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSecret } from '@/lib/secret-registry';

const STATE_SIGNATURE_LENGTH = 16;

function stateSecret(): string | null {
  return getSecret('OAUTH_STATE_SECRET');
}

export function createOAuthState(payload: Record<string, unknown>): string | null {
  const secret = stateSecret();
  if (!secret) return null;

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('hex')
    .slice(0, STATE_SIGNATURE_LENGTH);
  return `${encoded}.${signature}`;
}

export function verifyOAuthState<T extends { ts?: number }>(
  state: string,
  ttlMs: number,
): T | null {
  const secret = stateSecret();
  if (!secret) return null;

  const separator = state.lastIndexOf('.');
  if (separator < 0) return null;

  const encoded = state.slice(0, separator);
  const supplied = Buffer.from(state.slice(separator + 1));
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(encoded)
      .digest('hex')
      .slice(0, STATE_SIGNATURE_LENGTH),
  );
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
    if (typeof payload.ts !== 'number' || Date.now() - payload.ts > ttlMs) return null;
    return payload;
  } catch {
    return null;
  }
}
