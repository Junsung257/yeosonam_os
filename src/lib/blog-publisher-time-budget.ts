export function getPublisherRemainingMs(startedAtMs: number, maxExecMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(maxExecMs) || maxExecMs <= 0) return 0;
  return Math.max(0, Math.floor(maxExecMs - (nowMs - startedAtMs)));
}

export function canStartPublisherItem(remainingMs: number, minItemStartMs: number): boolean {
  return Number.isFinite(remainingMs)
    && Number.isFinite(minItemStartMs)
    && remainingMs >= Math.max(0, minItemStartMs);
}

export function canStartPublisherItemWithFallback(input: {
  remainingMs: number;
  minItemStartMs: number;
  fallbackMinItemStartMs: number;
  fallbackEligible: boolean;
}): boolean {
  // Deterministic fallback copy is not publishable. A shorter fallback window
  // therefore cannot authorize starting another queue item.
  return canStartPublisherItem(input.remainingMs, input.minItemStartMs);
}

export function getPublisherGenerationTimeoutMs(
  remainingMs: number,
  defaultTimeoutMs: number,
  finishReserveMs: number,
  minTimeoutMs = 10_000,
): number {
  if (!Number.isFinite(remainingMs) || !Number.isFinite(defaultTimeoutMs)) return 0;
  const usableMs = Math.floor(remainingMs - Math.max(0, finishReserveMs));
  if (usableMs < minTimeoutMs) return 0;
  return Math.max(minTimeoutMs, Math.min(Math.floor(defaultTimeoutMs), usableMs));
}

export function canRunOptionalPublisherWork(remainingMs: number, minRemainingMs: number): boolean {
  return Number.isFinite(remainingMs)
    && Number.isFinite(minRemainingMs)
    && remainingMs >= Math.max(0, minRemainingMs);
}

export type PublisherExtraClaimRecoveryPlan = {
  canClaim: boolean;
  claimLimit: number;
  fallbackEligibleOnly: boolean;
  remainingQuota: number;
  reason: 'quota_filled' | 'insufficient_time' | 'fallback_only_window' | 'normal_generation_window';
};

export function getPublisherExtraClaimRecoveryPlan(input: {
  remainingMs: number;
  minItemStartMs: number;
  fallbackMinItemStartMs: number;
  remainingQuota: number;
  maxBatch: number;
  claimPoolMultiplier: number;
  maxCandidatePool: number;
}): PublisherExtraClaimRecoveryPlan {
  const remainingQuota = Math.max(0, Math.floor(Number.isFinite(input.remainingQuota) ? input.remainingQuota : 0));
  const maxBatch = Math.max(1, Math.floor(Number.isFinite(input.maxBatch) ? input.maxBatch : 1));
  const claimPoolMultiplier = Math.max(1, Math.floor(Number.isFinite(input.claimPoolMultiplier)
    ? input.claimPoolMultiplier
    : 1));
  const maxCandidatePool = Math.max(maxBatch, Math.floor(Number.isFinite(input.maxCandidatePool)
    ? input.maxCandidatePool
    : maxBatch));
  const claimLimit = Math.min(
    maxCandidatePool,
    Math.max(maxBatch, remainingQuota * claimPoolMultiplier),
  );

  if (remainingQuota <= 0) {
    return {
      canClaim: false,
      claimLimit: 0,
      fallbackEligibleOnly: false,
      remainingQuota,
      reason: 'quota_filled',
    };
  }

  if (canStartPublisherItem(input.remainingMs, input.minItemStartMs)) {
    return {
      canClaim: true,
      claimLimit,
      fallbackEligibleOnly: false,
      remainingQuota,
      reason: 'normal_generation_window',
    };
  }

  return {
    canClaim: false,
    claimLimit: 0,
    fallbackEligibleOnly: false,
    remainingQuota,
    reason: 'insufficient_time',
  };
}

export function sortPublisherQueueForTimeBudget<T>(
  items: T[],
  input: {
    remainingMs: number;
    minItemStartMs: number;
    fallbackMinItemStartMs: number;
    isFallbackEligible: (item: T) => boolean;
  },
): T[] {
  const shouldPreferFallback =
    !canStartPublisherItem(input.remainingMs, input.minItemStartMs)
    && canStartPublisherItem(input.remainingMs, input.fallbackMinItemStartMs);
  if (!shouldPreferFallback) return [...items];

  return [...items].sort((a, b) => {
    const aEligible = input.isFallbackEligible(a);
    const bEligible = input.isFallbackEligible(b);
    if (aEligible === bEligible) return 0;
    return aEligible ? -1 : 1;
  });
}

export function getUnattemptedClaimReleaseIds<T extends { id?: string | null }>(
  claimedRows: T[],
  attemptedIds: Set<string>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const row of claimedRows) {
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
    if (!id || attemptedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}
