export function getPublisherRemainingMs(startedAtMs: number, maxExecMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(maxExecMs) || maxExecMs <= 0) return 0;
  return Math.max(0, Math.floor(maxExecMs - (nowMs - startedAtMs)));
}

export function canStartPublisherItem(remainingMs: number, minItemStartMs: number): boolean {
  return Number.isFinite(remainingMs)
    && Number.isFinite(minItemStartMs)
    && remainingMs >= Math.max(0, minItemStartMs);
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
