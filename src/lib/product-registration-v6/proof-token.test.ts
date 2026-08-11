import { afterEach, describe, expect, it } from 'vitest';

import { createProductRegistrationV6ProofToken, verifyProductRegistrationV6ProofToken } from './proof-token';

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
});
