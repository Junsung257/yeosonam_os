import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getSecret } from '@/lib/secret-registry';

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

export type OAuthStateProvider = 'meta' | 'threads' | 'google' | 'naver';

export interface OAuthStatePayload {
  tenant_id: string;
  provider: OAuthStateProvider;
  nonce: string;
  ts: number;
}

export class OAuthStateConfigurationError extends Error {
  constructor() {
    super('OAUTH_STATE_SECRET is required');
    this.name = 'OAuthStateConfigurationError';
  }
}

function requireStateSecret(): string {
  const secret = getSecret('OAUTH_STATE_SECRET');
  if (!secret) throw new OAuthStateConfigurationError();
  return secret;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqualBase64Url(actual: string, expected: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(actual)) return false;
  const actualBuffer = Buffer.from(actual, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isOAuthStateConfigured(): boolean {
  return Boolean(getSecret('OAUTH_STATE_SECRET'));
}

export function createOAuthState(input: {
  tenantId: string;
  provider: OAuthStateProvider;
  now?: number;
}): string {
  const secret = requireStateSecret();
  const payload: OAuthStatePayload = {
    tenant_id: input.tenantId,
    provider: input.provider,
    nonce: randomBytes(16).toString('base64url'),
    ts: input.now ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signPayload(encoded, secret)}`;
}

export function verifyOAuthState(
  state: string,
  expectedProvider: OAuthStateProvider | readonly OAuthStateProvider[],
  options?: { now?: number; ttlMs?: number },
): OAuthStatePayload | null {
  const secret = requireStateSecret();
  const separator = state.lastIndexOf('.');
  if (separator <= 0 || separator === state.length - 1) return null;

  const encoded = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  const expectedSignature = signPayload(encoded, secret);
  if (!safeEqualBase64Url(signature, expectedSignature)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    const providers = Array.isArray(expectedProvider) ? expectedProvider : [expectedProvider];
    if (
      typeof decoded.tenant_id !== 'string' ||
      !decoded.tenant_id ||
      typeof decoded.provider !== 'string' ||
      !providers.includes(decoded.provider as OAuthStateProvider) ||
      typeof decoded.nonce !== 'string' ||
      decoded.nonce.length < 16 ||
      typeof decoded.ts !== 'number' ||
      !Number.isFinite(decoded.ts)
    ) {
      return null;
    }

    const now = options?.now ?? Date.now();
    const age = now - decoded.ts;
    if (age < -MAX_CLOCK_SKEW_MS || age > (options?.ttlMs ?? DEFAULT_STATE_TTL_MS)) return null;

    return decoded as OAuthStatePayload;
  } catch {
    return null;
  }
}
