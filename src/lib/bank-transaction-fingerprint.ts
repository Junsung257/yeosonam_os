import { createHash } from 'crypto';

export interface BankTransactionFingerprintInput {
  tenantId?: string | null;
  accountNumber?: string | null;
  receivedAt: string;
  txType: string;
  amount: number;
  counterpartyName?: string | null;
  memo?: string | null;
}

export interface BankTransactionSimilarityCandidate {
  amount: number;
  transaction_type: string;
  counterparty_name: string | null;
  received_at: string;
  memo?: string | null;
}

export function normalizeBankTransactionText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.,()[\]{}]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function normalizeBankTransactionMemo(value: string | null | undefined): string {
  return normalizeBankTransactionText(value);
}

export function bankTransactionSecondBucket(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setMilliseconds(0);
  return d.toISOString().slice(0, 19);
}

export function buildBankTransactionFingerprint(input: BankTransactionFingerprintInput): string {
  const stable = [
    input.tenantId ?? 'platform',
    normalizeBankTransactionText(input.accountNumber),
    input.txType,
    Math.round(Number(input.amount || 0)),
    normalizeBankTransactionText(input.counterpartyName),
    normalizeBankTransactionMemo(input.memo),
    bankTransactionSecondBucket(input.receivedAt),
  ].join('|');

  return `sha256:${createHash('sha256').update(stable).digest('hex')}`;
}

export function scoreBankTransactionSimilarity(
  candidate: BankTransactionSimilarityCandidate,
  incoming: BankTransactionFingerprintInput,
): number {
  if (candidate.transaction_type !== incoming.txType || Number(candidate.amount) !== Number(incoming.amount)) {
    return 0;
  }

  const candidateName = normalizeBankTransactionText(candidate.counterparty_name);
  const incomingName = normalizeBankTransactionText(incoming.counterpartyName);
  const sameName =
    candidateName &&
    incomingName &&
    (candidateName === incomingName || candidateName.includes(incomingName) || incomingName.includes(candidateName));
  if (!sameName) return 0;

  const diffMs = Math.abs(new Date(candidate.received_at).getTime() - new Date(incoming.receivedAt).getTime());
  const candidateMemo = normalizeBankTransactionMemo(candidate.memo);
  const incomingMemo = normalizeBankTransactionMemo(incoming.memo);
  const sameMemo = candidateMemo && incomingMemo && candidateMemo === incomingMemo;
  if (!Number.isFinite(diffMs)) return sameMemo ? 0.82 : 0.62;
  if (diffMs <= 1_000 && sameMemo) return 0.88;
  if (diffMs <= 60_000 && sameMemo) return 0.82;
  if (diffMs <= 5 * 60_000) return sameMemo ? 0.76 : 0.68;
  if (diffMs <= 60 * 60_000) return sameMemo ? 0.7 : 0.6;
  return 0.65;
}
