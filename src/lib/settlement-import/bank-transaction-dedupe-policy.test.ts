import { describe, expect, it } from 'vitest';
import {
  canFuzzyMatchProviderTransaction,
  isClobeBootstrapCandidate,
  isClobeLegacyDuplicateCandidate,
  isProbableBankTransactionDuplicate,
  isUniqueClobeLegacyDuplicate,
  selectUniqueClobeBootstrapCandidate,
} from './bank-transaction-dedupe-policy';

describe('canFuzzyMatchProviderTransaction', () => {
  it('keeps distinct rows from the same provider even when their bank details are similar', () => {
    expect(canFuzzyMatchProviderTransaction({
      incomingExternalProvider: 'clobe',
      incomingExternalTransactionId: 'transaction-2',
      existingExternalProvider: 'clobe',
      existingExternalTransactionId: 'transaction-1',
    })).toBe(false);
  });

  it('still allows legacy and provider-less rows to be reconciled', () => {
    expect(canFuzzyMatchProviderTransaction({
      incomingExternalProvider: 'clobe',
      incomingExternalTransactionId: 'transaction-2',
      existingExternalProvider: null,
      existingExternalTransactionId: null,
    })).toBe(true);
  });
});

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

  it('reconciles an unlinked Clobe bootstrap row only within the same bank minute', () => {
    expect(isClobeBootstrapCandidate({
      incomingSource: 'clobe_mcp',
      existingSource: 'clobe_mcp',
      existingExternalTransactionId: null,
      sameTransactionType: true,
      sameAmount: true,
      sameCounterparty: true,
      sameMinute: true,
    })).toBe(true);

    expect(isClobeBootstrapCandidate({
      incomingSource: 'clobe_mcp',
      existingSource: 'clobe_mcp',
      existingExternalTransactionId: 'provider-1',
      sameTransactionType: true,
      sameAmount: true,
      sameCounterparty: true,
      sameMinute: true,
    })).toBe(false);
  });

  it('uses the memo to separate legitimate same-minute payments', () => {
    const candidates = [
      { value: 'booking-a', sameMemo: true },
      { value: 'booking-b', sameMemo: false },
    ];

    expect(selectUniqueClobeBootstrapCandidate(candidates)).toBe('booking-a');
    expect(selectUniqueClobeBootstrapCandidate([
      { value: 'booking-a', sameMemo: true },
      { value: 'booking-b', sameMemo: true },
    ])).toBeNull();
  });

  it('allows a unique row without the same memo so a later memo edit is flagged', () => {
    expect(selectUniqueClobeBootstrapCandidate([
      { value: 'only-row', sameMemo: false },
    ])).toBe('only-row');
    expect(selectUniqueClobeBootstrapCandidate([
      { value: 'row-a', sameMemo: false },
      { value: 'row-b', sameMemo: false },
    ])).toBeNull();
  });
});
