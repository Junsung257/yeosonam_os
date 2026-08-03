/**
 * Similarity is allowed to merge only when it is strong enough to represent
 * the same bank row. Weaker matches are hints for review, never a reason to
 * discard an incoming transaction.
 */
export function isProbableBankTransactionDuplicate(score: number): boolean {
  return Number.isFinite(score) && score >= 0.75;
}
const LEGACY_BANK_SOURCES = new Set(['slack_webhook', 'slack_gap_fill', 'bulk_import', 'manual']);

export function canFuzzyMatchProviderTransaction(input: {
  incomingExternalProvider?: string | null;
  incomingExternalTransactionId?: string | null;
  existingExternalProvider?: string | null;
  existingExternalTransactionId?: string | null;
}): boolean {
  const sameProvider = Boolean(
    input.incomingExternalProvider
    && input.existingExternalProvider
    && input.incomingExternalProvider === input.existingExternalProvider,
  );
  const hasDistinctProviderIds = Boolean(
    input.incomingExternalTransactionId
    && input.existingExternalTransactionId
    && input.incomingExternalTransactionId !== input.existingExternalTransactionId,
  );

  // Provider transaction IDs are the authoritative bank-row identity. Similar
  // timestamps or amounts must not collapse two real rows from the same feed.
  return !(sameProvider && hasDistinctProviderIds);
}

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

export function isClobeBootstrapCandidate(input: {
  incomingSource?: string;
  existingSource?: string | null;
  existingExternalTransactionId?: string | null;
  sameTransactionType: boolean;
  sameAmount: boolean;
  sameCounterparty: boolean;
  sameMinute: boolean;
}): boolean {
  return input.incomingSource === 'clobe_mcp'
    && input.existingSource === 'clobe_mcp'
    && !input.existingExternalTransactionId
    && input.sameTransactionType
    && input.sameAmount
    && input.sameCounterparty
    && input.sameMinute;
}

export function selectUniqueClobeBootstrapCandidate<T>(
  candidates: Array<{ value: T; sameMemo: boolean }>,
): T | null {
  const sameMemo = candidates.filter(candidate => candidate.sameMemo);
  if (sameMemo.length === 1) return sameMemo[0].value;
  if (sameMemo.length > 1) return null;
  return candidates.length === 1 ? candidates[0].value : null;
}
