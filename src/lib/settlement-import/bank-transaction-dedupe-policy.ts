/**
 * Similarity is allowed to merge only when it is strong enough to represent
 * the same bank row. Weaker matches are hints for review, never a reason to
 * discard an incoming transaction.
 */
export function isProbableBankTransactionDuplicate(score: number): boolean {
  return Number.isFinite(score) && score >= 0.75;
}

const LEGACY_BANK_SOURCES = new Set(['slack_webhook', 'slack_gap_fill', 'bulk_import', 'manual']);

export function isClobeLegacyDuplicateCandidate(input: {
  incomingSource?: string;
  existingSource?: string | null;
  sameTransactionType: boolean;
  sameAmount: boolean;
  sameCounterparty: boolean;
  timeDifferenceMs: number;
}): boolean {
  return input.incomingSource === 'clobe_mcp'
    && LEGACY_BANK_SOURCES.has(input.existingSource ?? '')
    && input.sameTransactionType
    && input.sameAmount
    && input.sameCounterparty
    && Number.isFinite(input.timeDifferenceMs)
    && input.timeDifferenceMs <= 60_000;
}

export function isUniqueClobeLegacyDuplicate(
  candidate: boolean,
  candidateCount: number,
): boolean {
  return candidate && candidateCount === 1;
}
