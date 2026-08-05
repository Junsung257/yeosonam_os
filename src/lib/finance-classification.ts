export type FinanceClassification =
  | 'company_expense'
  | 'tax'
  | 'capital'
  | 'transfer'
  | 'refund'
  | 'owner_draw'
  | 'other_income'
  | 'review';

export type FinanceClassificationSource = 'manual' | 'os_rule' | 'clobe' | 'review';

export interface FinanceClassificationTransaction {
  id: string;
  transaction_type: '입금' | '출금' | string;
  counterparty_name?: string | null;
  memo?: string | null;
  received_at: string;
  provider_category?: string | null;
  provider_is_unclassified?: boolean | null;
}

export interface FinanceClassificationOverride {
  os_classification?: FinanceClassification | null;
  confirmed_at?: string | null;
  is_profit_and_loss?: boolean | null;
}

export interface FinanceClassificationRule {
  id: string;
  priority: number;
  counterparty_pattern?: string | null;
  memo_pattern?: string | null;
  direction?: 'deposit' | 'withdrawal' | null;
  target_classification: FinanceClassification;
  is_profit_and_loss: boolean;
  apply_to_existing?: boolean;
  effective_from: string;
  is_active: boolean;
}

export interface ResolvedFinanceClassification {
  classification: FinanceClassification;
  source: FinanceClassificationSource;
  isProfitAndLoss: boolean;
  ruleId: string | null;
}

const NON_PROFIT_CLASSES = new Set<FinanceClassification>(['capital', 'transfer', 'refund', 'owner_draw']);

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLowerCase();
}

function patternMatches(value: string, pattern: string | null | undefined): boolean {
  if (!pattern) return true;
  const candidate = normalized(value);
  try {
    return new RegExp(pattern, 'iu').test(candidate);
  } catch {
    return candidate.includes(normalized(pattern));
  }
}

export function defaultProfitAndLoss(classification: FinanceClassification): boolean {
  return !NON_PROFIT_CLASSES.has(classification);
}

export function classificationFromClobe(
  category: string | null | undefined,
  transactionType: string,
  isUnclassified?: boolean | null,
): FinanceClassification {
  const value = normalized(category);
  if (!value || isUnclassified === true) return 'review';
  if (/세금|국세|지방세|부가세/.test(value)) return 'tax';
  if (/자본|증자|대여금|차입금/.test(value)) return 'capital';
  if (/이체|계좌이동/.test(value)) return 'transfer';
  if (/대표자|인출/.test(value)) return 'owner_draw';
  if (/환불|취소/.test(value)) return 'refund';
  return transactionType === '입금' ? 'other_income' : 'company_expense';
}

export function resolveFinanceClassification(params: {
  transaction: FinanceClassificationTransaction;
  override?: FinanceClassificationOverride | null;
  rules?: FinanceClassificationRule[];
}): ResolvedFinanceClassification {
  const { transaction, override } = params;

  if (override?.os_classification && override.confirmed_at) {
    return {
      classification: override.os_classification,
      source: 'manual',
      isProfitAndLoss: override.is_profit_and_loss ?? defaultProfitAndLoss(override.os_classification),
      ruleId: null,
    };
  }

  const direction = transaction.transaction_type === '입금' ? 'deposit' : 'withdrawal';
  const transactionAt = new Date(transaction.received_at).getTime();
  const matchingRule = [...(params.rules ?? [])]
    .filter(rule => rule.is_active)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .find(rule => {
      if (rule.direction && rule.direction !== direction) return false;
      if (!rule.apply_to_existing && transactionAt < new Date(rule.effective_from).getTime()) return false;
      return patternMatches(transaction.counterparty_name ?? '', rule.counterparty_pattern)
        && patternMatches(transaction.memo ?? '', rule.memo_pattern);
    });

  if (matchingRule) {
    return {
      classification: matchingRule.target_classification,
      source: 'os_rule',
      isProfitAndLoss: matchingRule.is_profit_and_loss,
      ruleId: matchingRule.id,
    };
  }

  const clobe = classificationFromClobe(
    transaction.provider_category,
    transaction.transaction_type,
    transaction.provider_is_unclassified,
  );
  return {
    classification: clobe,
    source: clobe === 'review' ? 'review' : 'clobe',
    isProfitAndLoss: defaultProfitAndLoss(clobe),
    ruleId: null,
  };
}

export function toProfitErpCategory(classification: FinanceClassification): string {
  switch (classification) {
    case 'company_expense': return '기타 영업비용';
    case 'tax': return '세금과공과';
    case 'capital': return '자본금';
    case 'transfer': return '내부 이체';
    case 'refund': return '환불';
    case 'owner_draw': return '대표자 인출';
    case 'other_income': return '기타 영업수익';
    default: return '미분류';
  }
}
