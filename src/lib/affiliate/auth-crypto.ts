import crypto from 'node:crypto';
import { getSecret } from '@/lib/secret-registry';

const AUTH_CONTEXT = 'yeosonam-affiliate-auth-v2';
const OUTBOX_CONTEXT = 'yeosonam-affiliate-outbox-v1';
const OTP_CONTEXT = 'yeosonam-affiliate-otp-v1';

function requireRootSecret(): Buffer {
  const raw = (getSecret('AFFILIATE_AUTH_SECRET') || '').trim();
  if (raw.length < 32) {
    throw new Error('AFFILIATE_AUTH_SECRET must contain at least 32 characters');
  }
  return Buffer.from(raw, 'utf8');
}

function deriveKey(context: string): Buffer {
  return crypto.createHmac('sha256', requireRootSecret()).update(context).digest();
}

export function assertAffiliateAuthConfigured(): void {
  requireRootSecret();
}

export function getAffiliateJwtSecret(): Uint8Array {
  return new Uint8Array(deriveKey(AUTH_CONTEXT));
}

export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateAffiliateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOpaqueValue(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashAffiliateOtp(invitationId: string, otp: string): string {
  return crypto
    .createHmac('sha256', deriveKey(OTP_CONTEXT))
    .update(`${invitationId}:${otp.trim()}`)
    .digest('hex');
}

export function fingerprintAffiliateRequest(value: string | null | undefined): string | null {
  const normalized = (value || '').trim();
  return normalized ? hashOpaqueValue(normalized) : null;
}

export function encryptAffiliateOutboxPayload(payload: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(OUTBOX_CONTEXT), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptAffiliateOutboxPayload<T extends Record<string, unknown>>(encrypted: string): T {
  const [version, ivPart, tagPart, ciphertextPart] = encrypted.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Invalid affiliate outbox payload');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(OUTBOX_CONTEXT),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

