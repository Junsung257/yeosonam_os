import { describe, expect, it } from 'vitest';
import {
  bankTransactionSecondBucket,
  buildBankTransactionFingerprint,
  normalizeBankTransactionText,
  scoreBankTransactionSimilarity,
} from './bank-transaction-fingerprint';

describe('bank transaction fingerprint', () => {
  it('normalizes counterparty names for SMS and bank statement imports', () => {
    expect(normalizeBankTransactionText(' Hong Gil-Dong Bank (Ltd.) ')).toBe('honggildongbankltd');
  });

  it('uses statement memo and second precision so separate same-minute rows stay separate', () => {
    const first = buildBankTransactionFingerprint({
      tenantId: 'tenant-a',
      receivedAt: '2026-06-06T10:23:44+09:00',
      txType: 'deposit',
      amount: 200000,
      counterpartyName: 'Hong Gil Dong',
      memo: '260715_정지해_투어폰',
    });
    const second = buildBankTransactionFingerprint({
      tenantId: 'tenant-a',
      receivedAt: '2026-06-06T10:23:04+09:00',
      txType: 'deposit',
      amount: 200000,
      counterpartyName: 'Hong-Gil-Dong',
      memo: '260715_정지해_투어폰',
    });

    expect(first).not.toBe(second);
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

  it('buckets timestamps by second', () => {
    expect(bankTransactionSecondBucket('2026-06-06T10:23:59+09:00')).toBe('2026-06-06T01:23:59');
  });

  it('keeps nearby same-name same-amount rows below automatic merge confidence', () => {
    const score = scoreBankTransactionSimilarity(
      {
        transaction_type: 'deposit',
        amount: 200000,
        counterparty_name: 'Hong Gil Dong',
        received_at: '2026-06-06T10:20:00+09:00',
        memo: '260715_정지해_투어폰',
      },
      {
        txType: 'deposit',
        amount: 200000,
        counterpartyName: 'Hong-Gil-Dong',
        receivedAt: '2026-06-06T10:23:00+09:00',
        memo: '260715_정지해_투어폰',
      },
    );

    expect(score).toBeLessThan(0.9);
  });
});
