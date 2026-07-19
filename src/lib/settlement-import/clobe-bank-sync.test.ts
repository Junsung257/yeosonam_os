import { describe, expect, it } from 'vitest';
import {
  extractTransactionArray,
  normalizeClobeBankTransaction,
  normalizeClobeBankTransactions,
} from './clobe-bank-sync';

describe('clobe bank sync normalization', () => {
  it('normalizes signed Clobe transaction rows to import rows', () => {
    const row = normalizeClobeBankTransaction({
      id: 'clobe-tx-1',
      transactionDate: '2026-07-09 10:12:48',
      accountNumber: '100038454128',
      counterpartyName: 'payer-a',
      amount: 698000,
      memo: '260715_customer_tourphone',
    });

    expect(row).toMatchObject({
      receivedAt: '2026-07-09T10:12:48+09:00',
      accountNumber: '100038454128',
      counterpartyName: 'payer-a',
      depositAmount: 698000,
      withdrawAmount: 0,
      memo: '260715_customer_tourphone',
      externalProvider: 'clobe',
      externalTransactionId: 'clobe-tx-1',
    });
  });

  it('uses direction fields when Clobe amount is absolute', () => {
    const row = normalizeClobeBankTransaction({
      transaction_at: '2026-06-29 17:47:24',
      type: 'withdraw',
      transaction_amount: 1286700,
      counterparty: 'tourphone',
      note: '260715_customer_tourphone',
    });

    expect(row?.depositAmount).toBe(0);
    expect(row?.withdrawAmount).toBe(1286700);
  });

  it('extracts transaction arrays from common MCP result envelopes', () => {
    expect(extractTransactionArray({ data: { transactions: [{ id: 'a' }] } })).toEqual([{ id: 'a' }]);
    expect(extractTransactionArray({ items: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
    expect(extractTransactionArray({ content: [{ type: 'text', text: '{"transactions":[{"id":"c"}]}' }] })).toEqual([{ id: 'c' }]);
  });

  it('returns normalization errors for incomplete rows without throwing', () => {
    const result = normalizeClobeBankTransactions({
      transactions: [
        { id: 'ok', posted_at: '2026-07-09 10:12:48', amount: 1000, memo: '260715_customer_tourphone' },
        { id: 'bad', amount: 1000 },
      ],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([{ index: 1, reason: 'missing required transaction fields' }]);
  });
});
