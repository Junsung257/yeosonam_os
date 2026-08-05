import { describe, expect, it } from 'vitest';

import { defaultProfitAndLoss, resolveFinanceClassification } from './finance-classification';

const transaction = {
  id: 'tx-1',
  transaction_type: '출금' as const,
  counterparty_name: '주식회사 버셀',
  memo: 'VERCEL',
  received_at: '2026-08-05T00:00:00Z',
  provider_category: '지급수수료',
  provider_is_unclassified: false,
};

describe('finance classification precedence', () => {
  it('keeps refunds, capital, transfers, and owner draws out of profit', () => {
    expect(defaultProfitAndLoss('refund')).toBe(false);
    expect(defaultProfitAndLoss('capital')).toBe(false);
    expect(defaultProfitAndLoss('transfer')).toBe(false);
    expect(defaultProfitAndLoss('owner_draw')).toBe(false);
  });

  it('uses manual confirmation before an OS rule and Clobe', () => {
    const result = resolveFinanceClassification({
      transaction,
      override: { os_classification: 'owner_draw', confirmed_at: '2026-08-05T01:00:00Z' },
      rules: [{
        id: 'rule-1',
        priority: 1,
        memo_pattern: 'vercel',
        target_classification: 'company_expense',
        is_profit_and_loss: true,
        effective_from: '2026-08-01T00:00:00Z',
        is_active: true,
      }],
    });

    expect(result).toEqual({
      classification: 'owner_draw',
      source: 'manual',
      isProfitAndLoss: false,
      ruleId: null,
    });
  });

  it('does not apply a new rule retroactively unless explicitly enabled', () => {
    const result = resolveFinanceClassification({
      transaction: { ...transaction, received_at: '2026-07-01T00:00:00Z' },
      rules: [{
        id: 'rule-1',
        priority: 1,
        memo_pattern: 'vercel',
        target_classification: 'transfer',
        is_profit_and_loss: false,
        apply_to_existing: false,
        effective_from: '2026-08-01T00:00:00Z',
        is_active: true,
      }],
    });

    expect(result.source).toBe('clobe');
    expect(result.classification).toBe('company_expense');
  });

  it('uses the first matching rule by priority', () => {
    const result = resolveFinanceClassification({
      transaction,
      rules: [
        {
          id: 'later',
          priority: 20,
          memo_pattern: 'vercel',
          target_classification: 'review',
          is_profit_and_loss: true,
          apply_to_existing: true,
          effective_from: '2026-01-01T00:00:00Z',
          is_active: true,
        },
        {
          id: 'first',
          priority: 10,
          counterparty_pattern: '버셀',
          target_classification: 'company_expense',
          is_profit_and_loss: true,
          apply_to_existing: true,
          effective_from: '2026-01-01T00:00:00Z',
          is_active: true,
        },
      ],
    });

    expect(result.ruleId).toBe('first');
    expect(result.classification).toBe('company_expense');
  });
});
