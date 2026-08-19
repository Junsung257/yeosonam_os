const CONTINUE_STATUSES = new Set(['rewrite_queued']);
const RETRY_STATUSES = new Set(['deferred_buffer', 'deferred_time_budget']);

export function decideBlogContentGenerationPassV4(input: {
  status: string;
  completedPasses: number;
  maxPasses?: number;
}): 'continue' | 'retry' | 'finalize' {
  const maxPasses = Math.max(1, Math.min(5, Math.trunc(input.maxPasses ?? 5)));
  if (RETRY_STATUSES.has(input.status)) return 'retry';
  if (CONTINUE_STATUSES.has(input.status) && input.completedPasses < maxPasses) return 'continue';
  return 'finalize';
}
