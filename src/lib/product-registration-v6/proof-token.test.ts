import { afterEach, describe, expect, it } from 'vitest';

import {
  createProductRegistrationV6ProofToken,
  productRegistrationV6ProofCookieOptions,
  verifyProductRegistrationV6ProofToken,
} from './proof-token';

describe('V6 proof token', () => {
  const previous = process.env.PRODUCT_REGISTRATION_PROOF_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.PRODUCT_REGISTRATION_PROOF_SECRET;
    else process.env.PRODUCT_REGISTRATION_PROOF_SECRET = previous;
  });

  it('binds access to one package, immutable snapshot hash, and expiry', () => {
    process.env.PRODUCT_REGISTRATION_PROOF_SECRET = 'test-secret';
    const token = createProductRegistrationV6ProofToken({
      snapshotId: 'snapshot-1',
      snapshotHash: 'a'.repeat(64),
      packageId: 'package-1',
    });
    expect(verifyProductRegistrationV6ProofToken(token, {
      snapshotId: 'snapshot-1',
      snapshotHash: 'a'.repeat(64),
      packageId: 'package-1',
    })?.locale).toBe('ko-KR');
    expect(verifyProductRegistrationV6ProofToken(token, { snapshotId: 'snapshot-2' })).toBeNull();
  });

  it('rejects a modified signature', () => {
    process.env.PRODUCT_REGISTRATION_PROOF_SECRET = 'test-secret';
    const token = createProductRegistrationV6ProofToken({
      snapshotId: 'snapshot-1',
      snapshotHash: 'b'.repeat(64),
      packageId: 'package-1',
    });
    expect(verifyProductRegistrationV6ProofToken(`${token}x`)).toBeNull();
  });

  it('exchanges a verified token for a short-lived, path-scoped HttpOnly cookie', () => {
    const nowMs = 1_800_000_000_000;
    const claims = {
      snapshotId: 'snapshot-1',
      snapshotHash: 'c'.repeat(64),
      packageId: 'package-1',
      expiresAt: Math.floor(nowMs / 1000) + 600,
      locale: 'ko-KR',
    };

    expect(productRegistrationV6ProofCookieOptions(claims, 'packages', nowMs)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/packages/package-1',
      maxAge: 600,
    });
    expect(productRegistrationV6ProofCookieOptions(claims, 'lp', nowMs).path).toBe('/lp/package-1');
  });
});
