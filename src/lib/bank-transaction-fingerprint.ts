import { createHash } from 'crypto';

export interface BankTransactionFingerprintInput {
  tenantId?: string | null;
  receivedAt: string;
  txType: string;
  amount: number;
  counterpartyName?: string | null;
}

export interface BankTransactionSimilarityCandidate {
  amount: number;
  transaction_type: string;
  counterparty_name: string | null;
  received_at: string;
}

export function normalizeBankTransactionText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.,()[\]{}]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function bankTransactionMinuteBucket(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function buildBankTransactionFingerprint(input: BankTransactionFingerprintInput): string {
  const stable = [
    input.tenantId ?? 'platform',
    input.txType,
    Math.round(Number(input.amount || 0)),
    normalizeBankTransactionText(input.counterpartyName),
    bankTransactionMinuteBucket(input.receivedAt),
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
  if (!Number.isFinite(diffMs)) return 0.72;
  if (diffMs <= 60_000) return 0.98;
  if (diffMs <= 5 * 60_000) return 0.9;
  if (diffMs <= 60 * 60_000) return 0.78;
  return 0.65;
}
