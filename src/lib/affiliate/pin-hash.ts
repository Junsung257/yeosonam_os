import crypto from 'node:crypto';
import { getSecret } from '@/lib/secret-registry';

function pinSecret(): string {
  const secret = getSecret('AFFILIATE_JWT_SECRET');
  if (!secret) {
    throw new Error('AFFILIATE_JWT_SECRET is required');
  }
  return secret;
}

export function hashAffiliatePin(pin: string): string {
  return crypto
    .createHmac('sha256', pinSecret())
    .update(pin.trim())
    .digest('hex');
}
