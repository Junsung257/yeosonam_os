export interface BankTransactionAccountEvidence {
  accountNumber?: string;
  balanceAfter?: number;
  providerCategory?: string;
  providerIsUnclassified?: boolean;
}

export function accountEvidenceFieldsFor(row: BankTransactionAccountEvidence) {
  return {
    account_number: row.accountNumber?.replace(/\D/g, '') || null,
    balance_after: row.balanceAfter ?? null,
    provider_category: row.providerCategory ?? null,
    provider_is_unclassified: row.providerIsUnclassified ?? null,
  };
}

export function accountFieldsFor(
  row: BankTransactionAccountEvidence,
  settlementScope: 'travel' | 'non_travel',
) {
  return {
    settlement_scope: settlementScope,
    ...accountEvidenceFieldsFor(row),
  };
}
