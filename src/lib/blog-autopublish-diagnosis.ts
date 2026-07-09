export type BlogAutopublishDiagnosisBucket = {
  code: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  detail: string;
  evidence?: unknown;
};

export type BlogAutopublishDiagnosisState = {
  reportDay: string;
  currentDay: string;
  currentDayPublished: number;
  dailyTarget: number;
  currentDayPublisherHealthy: boolean;
  publishPreflightBlocked: boolean;
  candidateShortage: boolean;
};

export type BlogAutopublishDiagnosisBucketClassification = {
  active_buckets: BlogAutopublishDiagnosisBucket[];
  historical_buckets: BlogAutopublishDiagnosisBucket[];
  operating_status: 'healthy' | 'watch' | 'risk';
};

const HISTORICAL_WHEN_CURRENT_HEALTHY = new Set([
  'daily_publish_sla_miss',
  'publisher_cron_not_observed',
  'publisher_timeout',
]);

function currentPublishPathHealthy(state: BlogAutopublishDiagnosisState): boolean {
  return state.dailyTarget > 0
    && state.currentDayPublished >= state.dailyTarget
    && state.currentDayPublisherHealthy
    && !state.publishPreflightBlocked
    && !state.candidateShortage;
}

function shouldTreatAsHistorical(
  bucket: BlogAutopublishDiagnosisBucket,
  state: BlogAutopublishDiagnosisState,
): boolean {
  if (!currentPublishPathHealthy(state)) return false;
  if (!HISTORICAL_WHEN_CURRENT_HEALTHY.has(bucket.code)) return false;
  if (bucket.code === 'daily_publish_sla_miss' || bucket.code === 'publisher_cron_not_observed') {
    return state.reportDay !== state.currentDay;
  }
  return true;
}

export function classifyBlogAutopublishDiagnosisBuckets(
  buckets: BlogAutopublishDiagnosisBucket[],
  state: BlogAutopublishDiagnosisState,
): BlogAutopublishDiagnosisBucketClassification {
  const active_buckets: BlogAutopublishDiagnosisBucket[] = [];
  const historical_buckets: BlogAutopublishDiagnosisBucket[] = [];

  for (const bucket of buckets) {
    if (shouldTreatAsHistorical(bucket, state)) historical_buckets.push(bucket);
    else active_buckets.push(bucket);
  }

  const hasCriticalOrHigh = active_buckets.some(
    (bucket) => bucket.severity === 'critical' || bucket.severity === 'high',
  );
  const operating_status = hasCriticalOrHigh
    ? 'risk'
    : active_buckets.length > 0
      ? 'watch'
      : 'healthy';

  return { active_buckets, historical_buckets, operating_status };
}
