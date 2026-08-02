import { describe, expect, it } from 'vitest';
import { isProbableBankTransactionDuplicate } from './bank-transaction-dedupe-policy';

describe('isProbableBankTransactionDuplicate', () => {
  it('does not discard a row on a weak similarity hint', () => {
    expect(isProbableBankTransactionDuplicate(0.65)).toBe(false);
    expect(isProbableBankTransactionDuplicate(0.74)).toBe(false);
  });

  it('allows only the strong duplicate threshold', () => {
    expect(isProbableBankTransactionDuplicate(0.75)).toBe(true);
    expect(isProbableBankTransactionDuplicate(0.88)).toBe(true);
  });
});
