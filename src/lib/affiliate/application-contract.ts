import { createHash } from 'node:crypto';

export const AFFILIATE_TERMS_BUNDLE_VERSION = '2026-08-08.v1';

export function normalizeAffiliatePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function buildAffiliateApplicationIdempotencyKey(input: {
  requestedKey?: string | null;
  normalizedPhone: string;
  normalizedChannelUrl: string;
}): string {
  const requested = String(input.requestedKey ?? '').trim();
  if (requested) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requested)) {
      throw new Error('INVALID_IDEMPOTENCY_KEY');
    }
    return requested;
  }

  const digest = createHash('sha256')
    .update(`${input.normalizedPhone}\n${input.normalizedChannelUrl}`)
    .digest('hex');
  return `auto:${digest}`;
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === '23505',
  );
}
