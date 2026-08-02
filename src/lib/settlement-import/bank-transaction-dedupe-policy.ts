/**
 * Similarity is allowed to merge only when it is strong enough to represent
 * the same bank row. Weaker matches are hints for review, never a reason to
 * discard an incoming transaction.
 */
export function isProbableBankTransactionDuplicate(score: number): boolean {
  return Number.isFinite(score) && score >= 0.75;
}
