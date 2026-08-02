import { describe, expect, it } from 'vitest';
import {
  type BankTransaction,
  getOutflowLandingSubTab,
} from './PaymentsPageClient';

function transaction(input: Partial<BankTransaction>): BankTransaction {
  return {
    id: 'tx-1',
    raw_message: '',
    transaction_type: '입금',
    amount: 1_000,
    received_at: '2026-08-02T00:00:00.000Z',
    is_refund: false,
    is_fee: false,
    match_status: 'unmatched',
    match_confidence: 0,
    created_at: '2026-08-02T00:00:00.000Z',
    ...input,
  };
}

describe('getOutflowLandingSubTab', () => {
  it('shows all outflows when every outflow is already matched', () => {
    expect(getOutflowLandingSubTab([
      transaction({ transaction_type: '출금', match_status: 'manual' }),
      transaction({ transaction_type: '출금', match_status: 'auto' }),
    ])).toBe('all');
  });

  it('shows attention items first when an outflow needs review', () => {
    expect(getOutflowLandingSubTab([
      transaction({ transaction_type: '출금', match_status: 'manual' }),
      transaction({ transaction_type: '출금', match_status: 'review' }),
    ])).toBe('unmatched');
  });

  it('does not treat unmatched deposits as outflow attention', () => {
    expect(getOutflowLandingSubTab([
      transaction({ transaction_type: '입금', match_status: 'unmatched' }),
      transaction({ transaction_type: '출금', match_status: 'manual' }),
    ])).toBe('all');
  });
});
