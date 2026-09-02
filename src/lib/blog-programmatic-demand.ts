export interface ProgrammaticDemandProbeCandidate {
  id: number;
}

export interface ObservedProgrammaticKeywordDemand {
  monthly_search_volume?: number | null;
  trend_score?: number | null;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function hasObservedProgrammaticKeywordDemand(
  demand: ObservedProgrammaticKeywordDemand | null | undefined,
): boolean {
  return positiveNumber(demand?.monthly_search_volume) > 0
    || positiveNumber(demand?.trend_score) > 0;
}

export function selectDailyProgrammaticDemandProbe<T extends ProgrammaticDemandProbeCandidate>(
  candidates: T[],
  options: { limit: number; now?: Date },
): T[] {
  if (candidates.length === 0 || options.limit <= 0) return [];
  const probeSize = Math.min(candidates.length, Math.max(options.limit * 4, 20));
  if (probeSize >= candidates.length) return candidates.slice();

  const dayNumber = Math.floor((options.now ?? new Date()).getTime() / 86_400_000);
  const start = (dayNumber * probeSize) % candidates.length;
  return [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, probeSize);
}
