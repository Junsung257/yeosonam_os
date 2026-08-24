import { describe, expect, it } from 'vitest';
import {
  normalizeSettlementMemoKey,
  parseBankStatementRows,
  parseTravelSettlementMemo,
} from './bank-statement-parser';

describe('bank statement parser', () => {
  it('parses the signed 6-column bank export format', () => {
    const rows = parseBankStatementRows(
      '2026-07-09 10:12:48\t100038454128\t\t박수영김민주\t698000\t260715_정지해_투어폰',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      receivedAt: '2026-07-09T10:12:48+09:00',
      accountNumber: '100038454128',
      counterpartyName: '박수영김민주',
      depositAmount: 698000,
      withdrawAmount: 0,
      include: true,
    });
    expect(rows[0].travelMemo).toMatchObject({
      normalizedKey: '260715_정지해_투어폰',
      departureDate: '2026-07-15',
      leadCustomerName: '정지해',
      landOperatorName: '투어폰',
      purposeTags: [],
    });
  });

  it('parses signed withdrawals as positive withdraw amounts', () => {
    const rows = parseBankStatementRows(
      '2026-06-29 17:47:24\t100038454128\t\t주식회사투어폰\t-1286700\t260715_정지해_투어폰',
    );

    expect(rows[0].depositAmount).toBe(0);
    expect(rows[0].withdrawAmount).toBe(1286700);
  });

  it('keeps non-travel rows parsed but excluded by default', () => {
    const rows = parseBankStatementRows(
      '2026-07-08 18:19:11\t100038454128\t\tVERCEL\t2026\t',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].travelMemo).toBeNull();
    expect(rows[0].include).toBe(false);
  });

  it('supports the legacy deposit/withdraw split format', () => {
    const rows = parseBankStatementRows(
      '2026-07-09 10:02\t698,000\t0\t정지해\t260715_정지해_투어폰',
    );

    expect(rows[0]).toMatchObject({
      receivedAt: '2026-07-09T10:02:00+09:00',
      depositAmount: 698000,
      withdrawAmount: 0,
      counterpartyName: '정지해',
      memo: '260715_정지해_투어폰',
    });
  });

  it('normalizes the memo key without using payer name', () => {
    expect(normalizeSettlementMemoKey(' 260715 _ 정지해 _ 투어폰 ')).toBe('260715_정지해_투어폰');
    expect(parseTravelSettlementMemo('260715_정지해_투어폰')?.departureDate).toBe('2026-07-15');
  });

  it('normalizes a safe customer-operator separator variant without treating it as canonical', () => {
    expect(parseTravelSettlementMemo('260505_서진혜-더투어')).toMatchObject({
      normalizedKey: '260505_서진혜_더투어',
      leadCustomerName: '서진혜',
      landOperatorName: '더투어',
      memoFormat: 'separator_variant',
      purposeTags: [],
    });
  });

  it('keeps a registered purpose suffix in the settlement key but not in the operator identity', () => {
    expect(parseTravelSettlementMemo('260706_김도연_투어폰_환불')).toMatchObject({
      normalizedKey: '260706_김도연_투어폰_환불',
      departureDate: '2026-07-06',
      leadCustomerName: '김도연',
      landOperatorName: '투어폰',
      purposeTags: ['환불'],
    });
  });

  it('does not guess that an unknown operator suffix is a purpose tag', () => {
    expect(parseTravelSettlementMemo('260706_김도연_글로벌_투어')).toMatchObject({
      normalizedKey: '260706_김도연_글로벌_투어',
      landOperatorName: '글로벌_투어',
      purposeTags: [],
    });
  });
});
