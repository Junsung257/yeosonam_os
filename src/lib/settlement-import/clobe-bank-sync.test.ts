import { describe, expect, it } from 'vitest';
import {
  extractTransactionArray,
  extractClobeScrapingStatus,
  normalizeClobeBankTransaction,
  normalizeClobeBankTransactions,
  chooseTransactionTool,
  chooseClobeAccountNumberFromMetadataRows,
  normalizeClobeAccountId,
  rankTransactionTools,
} from './clobe-bank-sync';

describe('clobe bank sync normalization', () => {
  it('resolves the bank account from stored Clobe source metadata', () => {
    expect(chooseClobeAccountNumberFromMetadataRows([
      { source_metadata: { clobe_mcp: { account_number: '100-038-454128' } } },
      { source_metadata: { clobe_mcp: { account_number: '100038454128' } } },
      { source_metadata: { clobe_mcp: { account_number: '999-111' } } },
    ])).toBe('100038454128');
  });

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

  it('recognizes Clobe IN and OUT direction values', () => {
    const deposit = normalizeClobeBankTransaction({
      transactionAt: '2026-07-09 10:12:48',
      direction: 'IN',
      transactionAmount: 1000000,
    });
    const withdraw = normalizeClobeBankTransaction({
      transactionAt: '2026-07-09 11:12:48',
      direction: 'OUT',
      transactionAmount: 900000,
    });

    expect(deposit?.depositAmount).toBe(1000000);
    expect(deposit?.withdrawAmount).toBe(0);
    expect(withdraw?.depositAmount).toBe(0);
    expect(withdraw?.withdrawAmount).toBe(900000);
  });

  it('sends Clobe account IDs as positive integers', () => {
    expect(normalizeClobeAccountId('123')).toBe(123);
    expect(normalizeClobeAccountId(456)).toBe(456);
    expect(normalizeClobeAccountId(null)).toBeNull();
    expect(() => normalizeClobeAccountId('account-123')).toThrow('positive integer');
  });

  it('extracts safe Clobe scraping freshness diagnostics', () => {
    const statuses = extractClobeScrapingStatus({
      content: [{
        type: 'text',
        text: JSON.stringify({
          assets: [{
            assetType: 'BANK_ACCOUNT',
            status: 'ERROR',
            scrapedAt: '2026-07-30T01:00:00Z',
            failureCategory: 'CERTIFICATE_EXPIRED',
          }],
        }),
      }],
    });

    expect(statuses).toEqual([{
      assetType: 'BANK_ACCOUNT',
      status: 'ERROR',
      scrapedAt: '2026-07-30T01:00:00Z',
      failureCategory: 'CERTIFICATE_EXPIRED',
      failureMessage: null,
    }]);
  });

  it('extracts transaction arrays from common MCP result envelopes', () => {
    expect(extractTransactionArray({ data: { transactions: [{ id: 'a' }] } })).toEqual([{ id: 'a' }]);
    expect(extractTransactionArray({ items: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
    expect(extractTransactionArray({ entries: [{ id: 'entry-1' }] })).toEqual([{ id: 'entry-1' }]);
    expect(extractTransactionArray({ content: [{ type: 'text', text: '{"transactions":[{"id":"c"}]}' }] })).toEqual([{ id: 'c' }]);
  });

  it('extracts and normalizes the live Clobe content-array response', () => {
    const payload = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          content: [{
            transactionId: 987,
            accountId: 123,
            transactionAt: '2026-07-09 10:12:48',
            transactionName: '',
            transactionDescription: 'payer-a',
            transactionType: 'IN',
            inAmount: 698000,
            outAmount: 0,
            accountNumber: '100038454128',
            memo: '260715_customer_tourphone',
          }],
          totalElements: 1,
          hasNext: false,
          nextCursor: null,
        }),
      }],
      isError: false,
    };

    const rows = extractTransactionArray(payload);
    expect(rows).toHaveLength(1);
    expect(normalizeClobeBankTransaction(rows[0])).toMatchObject({
      receivedAt: '2026-07-09T10:12:48+09:00',
      counterpartyName: 'payer-a',
      depositAmount: 698000,
      withdrawAmount: 0,
      memo: '260715_customer_tourphone',
      externalTransactionId: '987',
    });
  });

  it('parses tab-separated bank rows returned as MCP text', () => {
    const rows = extractTransactionArray({
      content: [{
        type: 'text',
        text: '2026-07-09 10:12:48\t100038454128\t\t정지해\t698000\t260715_정지해_투어폰',
      }],
    });

    expect(normalizeClobeBankTransaction(rows[0])).toMatchObject({
      accountNumber: '100038454128',
      counterpartyName: '정지해',
      depositAmount: 698000,
      memo: '260715_정지해_투어폰',
    });
  });

  it('prioritizes bank transaction tools over general ledger tools', () => {
    const tools = [
      { name: 'get_journal_ledger', description: 'Read accounting journal ledger' },
      { name: 'get_monthly_revenue', description: 'Read monthly revenue' },
      { name: 'get_bank_transactions', description: 'Read bank account transactions' },
    ];

    expect(chooseTransactionTool(tools)).toBe('get_bank_transactions');
    expect(rankTransactionTools(tools).map(tool => tool.name)).toEqual([
      'get_bank_transactions',
    ]);
    expect(chooseTransactionTool(tools.filter(tool => tool.name !== 'get_bank_transactions'))).toBeNull();
  });

  it('never selects account listings or label mutation tools as transaction readers', () => {
    const tools = [
      { name: 'get_bank_accounts', description: 'Read bank account list' },
      { name: 'bulk_label_transactions', description: 'Apply labels to transactions' },
      { name: 'get_labels', description: 'Read labels' },
      {
        name: 'get_labeled_transactions',
        description: 'Read actual bank transactions. Use get_journal_ledger for accounting entries.',
      },
    ];

    expect(rankTransactionTools(tools).map(tool => tool.name)).toEqual([
      'get_labeled_transactions',
    ]);
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
