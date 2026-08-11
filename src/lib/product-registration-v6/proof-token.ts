import { createHmac, timingSafeEqual } from 'node:crypto';

import { getSecret } from '@/lib/secret-registry';

export type ProductRegistrationV6ProofClaims = {
  snapshotId: string;
  snapshotHash: string;
  packageId: string;
  expiresAt: number;
  locale: string;
};

function secret(): string {
  const value = getSecret('PRODUCT_REGISTRATION_PROOF_SECRET')
    || getSecret('REVALIDATE_SECRET')
    || getSecret('ADMIN_API_TOKEN');
  if (!value) throw new Error('PRODUCT_REGISTRATION_PROOF_SECRET_MISSING');
  return value;
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createProductRegistrationV6ProofToken(input: {
  snapshotId: string;
  snapshotHash: string;
  packageId: string;
  locale?: string;
  ttlSeconds?: number;
}): string {
  if (!/^[0-9a-f]{64}$/.test(input.snapshotHash)) throw new Error('V6_PROOF_SNAPSHOT_HASH_INVALID');
  const claims: ProductRegistrationV6ProofClaims = {
    snapshotId: input.snapshotId,
    snapshotHash: input.snapshotHash,
    packageId: input.packageId,
    expiresAt: Math.floor(Date.now() / 1000) + Math.max(60, Math.min(input.ttlSeconds ?? 600, 900)),
    locale: input.locale ?? 'ko-KR',
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyProductRegistrationV6ProofToken(
  token: string | null | undefined,
  expected?: Partial<Pick<ProductRegistrationV6ProofClaims, 'snapshotId' | 'snapshotHash' | 'packageId'>>,
): ProductRegistrationV6ProofClaims | null {
  if (!token) return null;
  const [payload, received] = token.split('.');
  if (!payload || !received) return null;
  try {
    const expectedSignature = signature(payload);
    const left = Buffer.from(received);
    const right = Buffer.from(expectedSignature);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ProductRegistrationV6ProofClaims;
    if (!claims.snapshotId || !claims.snapshotHash || !claims.packageId) return null;
    if (claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (expected?.snapshotId && claims.snapshotId !== expected.snapshotId) return null;
    if (expected?.snapshotHash && claims.snapshotHash !== expected.snapshotHash) return null;
    if (expected?.packageId && claims.packageId !== expected.packageId) return null;
    return claims;
  } catch {
    return null;
  }
}
