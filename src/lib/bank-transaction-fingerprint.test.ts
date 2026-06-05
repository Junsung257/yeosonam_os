import { describe, expect, it } from 'vitest';
import {
  bankTransactionMinuteBucket,
  buildBankTransactionFingerprint,
  normalizeBankTransactionText,
  scoreBankTransactionSimilarity,
} from './bank-transaction-fingerprint';

describe('bank transaction fingerprint', () => {
  it('normalizes counterparty names for SMS and bank statement imports', () => {
    expect(normalizeBankTransactionText(' Hong Gil-Dong Bank (Ltd.) ')).toBe('honggildongbankltd');
  });

  it('uses the same fingerprint for the same tenant transaction across import sources', () => {
    const sms = buildBankTransactionFingerprint({
      tenantId: 'tenant-a',
      receivedAt: '2026-06-06T10:23:44+09:00',
      txType: 'deposit',
      amount: 200000,
      counterpartyName: 'Hong Gil Dong',
    });
    const bankStatement = buildBankTransactionFingerprint({
      tenantId: 'tenant-a',
      receivedAt: '2026-06-06T10:23:04+09:00',
      txType: 'deposit',
      amount: 200000,
      counterpartyName: 'Hong-Gil-Dong',
    });

    expect(sms).toBe(bankStatement);
  });

  it('keeps tenant ledgers isolated even for visually identical transactions', () => {
    const common = {
      receivedAt: '2026-06-06T10:23:04+09:00',
      txType: 'deposit',
      amount: 200000,
      counterpartyName: 'Hong Gil Dong',
    };

    expect(buildBankTransactionFingerprint({ ...common, tenantId: 'tenant-a' }))
      .not.toBe(buildBankTransactionFingerprint({ ...common, tenantId: 'tenant-b' }));
  });

  it('buckets timestamps by minute', () => {
    expect(bankTransactionMinuteBucket('2026-06-06T10:23:59+09:00')).toBe('2026-06-06T01:23');
  });

  it('scores same-name same-amount nearby transactions as probable duplicates', () => {
    const score = scoreBankTransactionSimilarity(
      {
        transaction_type: 'deposit',
        amount: 200000,
        counterparty_name: 'Hong Gil Dong',
        received_at: '2026-06-06T10:20:00+09:00',
      },
      {
        txType: 'deposit',
        amount: 200000,
        counterpartyName: 'Hong-Gil-Dong',
        receivedAt: '2026-06-06T10:23:00+09:00',
      },
    );

    expect(score).toBeGreaterThanOrEqual(0.9);
  });
});
