import { describe, expect, it } from 'vitest';
import {
  isClobeLegacyDuplicateCandidate,
  isProbableBankTransactionDuplicate,
  isUniqueClobeLegacyDuplicate,
} from './bank-transaction-dedupe-policy';

describe('isProbableBankTransactionDuplicate', () => {
  it('does not discard a row on a weak similarity hint', () => {
    expect(isProbableBankTransactionDuplicate(0.65)).toBe(false);
    expect(isProbableBankTransactionDuplicate(0.74)).toBe(false);
  });

  it('allows only the strong duplicate threshold', () => {
    expect(isProbableBankTransactionDuplicate(0.75)).toBe(true);
    expect(isProbableBankTransactionDuplicate(0.88)).toBe(true);
  });

  it('recognizes a unique Clobe-to-legacy cross-source match within one minute', () => {
    const candidate = isClobeLegacyDuplicateCandidate({
      incomingSource: 'clobe_mcp',
      existingSource: 'slack_webhook',
      sameTransactionType: true,
      sameAmount: true,
      sameCounterparty: true,
      timeDifferenceMs: 55_000,
    });

    expect(isUniqueClobeLegacyDuplicate(candidate, 1)).toBe(true);
    expect(isUniqueClobeLegacyDuplicate(candidate, 2)).toBe(false);
  });

  it('does not cross-merge non-Clobe or ambiguous rows', () => {
    expect(isClobeLegacyDuplicateCandidate({
      incomingSource: 'bulk_import',
      existingSource: 'slack_webhook',
      sameTransactionType: true,
      sameAmount: true,
      sameCounterparty: true,
      timeDifferenceMs: 1_000,
    })).toBe(false);
    expect(isClobeLegacyDuplicateCandidate({
      incomingSource: 'clobe_mcp',
      existingSource: 'slack_webhook',
      sameTransactionType: true,
      sameAmount: true,
      sameCounterparty: true,
      timeDifferenceMs: 60_001,
    })).toBe(false);
  });
});
