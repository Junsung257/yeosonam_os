import { describe, expect, it } from 'vitest';

import { accountEvidenceFieldsFor, accountFieldsFor } from './bank-transaction-account-evidence';

describe('bank transaction account evidence', () => {
  const row = {
    accountNumber: '100-038-454128',
    balanceAfter: 20_864_610,
    providerCategory: 'other',
    providerIsUnclassified: false,
  };

  it('refreshes provider evidence without changing an existing settlement scope', () => {
    expect(accountEvidenceFieldsFor(row)).toEqual({
      account_number: '100038454128',
      balance_after: 20_864_610,
      provider_category: 'other',
      provider_is_unclassified: false,
    });
    expect(accountEvidenceFieldsFor(row)).not.toHaveProperty('settlement_scope');
  });

  it('sets settlement scope only when importing or intentionally reclassifying a row', () => {
    expect(accountFieldsFor(row, 'non_travel')).toEqual(expect.objectContaining({
      settlement_scope: 'non_travel',
      account_number: '100038454128',
    }));
  });
});
