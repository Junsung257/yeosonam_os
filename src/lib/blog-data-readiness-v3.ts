export interface BlogDataReadinessCountsV3 {
  searchPerformance30d: number | null;
  engagement7d: number | null;
  serverEvents30d: number | null;
  rum7d: number | null;
  currentSnapshots: number | null;
  outboxDead: number | null;
  outboxReady: number | null;
}

export interface BlogDataReadinessCheckV3 {
  metric: keyof BlogDataReadinessCountsV3;
  status: 'ok' | 'warning' | 'critical';
  count: number | null;
  reason: string;
}

export interface BlogDataReadinessReportV3 {
  status: 'ok' | 'warning' | 'critical';
  checks: BlogDataReadinessCheckV3[];
  generatedAt: string;
}

export function evaluateBlogDataReadinessV3(
  counts: BlogDataReadinessCountsV3,
  generatedAt = new Date(),
): BlogDataReadinessReportV3 {
  const required: Array<keyof BlogDataReadinessCountsV3> = [
    'searchPerformance30d',
    'engagement7d',
    'serverEvents30d',
    'rum7d',
    'currentSnapshots',
  ];
  const checks: BlogDataReadinessCheckV3[] = required.map((metric) => {
    const count = counts[metric];
    if (count == null) return { metric, status: 'critical', count, reason: 'query_unavailable' };
    if (count === 0) return { metric, status: 'critical', count, reason: 'zero_observed_rows' };
    return { metric, status: 'ok', count, reason: 'rows_observed' };
  });

  checks.push(counts.outboxDead == null
    ? { metric: 'outboxDead', status: 'critical', count: null, reason: 'query_unavailable' }
    : counts.outboxDead > 0
      ? { metric: 'outboxDead', status: 'critical', count: counts.outboxDead, reason: 'dead_letter_events_require_operator' }
      : { metric: 'outboxDead', status: 'ok', count: 0, reason: 'no_dead_letter_events' });
  checks.push(counts.outboxReady == null
    ? { metric: 'outboxReady', status: 'critical', count: null, reason: 'query_unavailable' }
    : counts.outboxReady > 100
      ? { metric: 'outboxReady', status: 'warning', count: counts.outboxReady, reason: 'outbox_backlog_above_100' }
      : { metric: 'outboxReady', status: 'ok', count: counts.outboxReady, reason: 'outbox_backlog_within_limit' });

  const status = checks.some((check) => check.status === 'critical')
    ? 'critical'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok';
  return { status, checks, generatedAt: generatedAt.toISOString() };
}
