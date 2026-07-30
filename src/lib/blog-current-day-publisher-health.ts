export type BlogCurrentDayPublisherIssueCode =
  | 'current_day_publisher_failed'
  | 'current_day_publisher_zero_published';

export type BlogCurrentDayPublisherHealth = {
  status: 'healthy' | 'risk';
  code: BlogCurrentDayPublisherIssueCode | null;
  detail: string;
  evidence: {
    current_day: string;
    current_day_published_count: number | null;
    daily_target: number | null;
    last_run_at: string | null;
    last_status: string | null;
    last_error_count: number;
    published: number | null;
    remaining_before_run: number | null;
    remaining_after_run: number | null;
    errors: string[];
    failure_breakdown: Record<string, unknown> | null;
    targeted_private_regeneration: boolean;
  };
};

type CronHealthLike = {
  last_status?: string | null;
  last_run_at?: string | null;
  last_error_count?: number | null;
  last_summary?: Record<string, unknown> | null;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDayKey(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstDayRange(dayKey: string): { start: Date; end: Date } {
  const start = new Date(`${dayKey}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function includesZeroPublishedSignal(summary: Record<string, unknown>, errors: string[]): boolean {
  const text = JSON.stringify({ summary, errors }).toLowerCase();
  return text.includes('publisher_zero_published_with_remaining_quota');
}

export function evaluateCurrentDayPublisherHealth(params: {
  cronHealth?: CronHealthLike | null;
  now?: Date;
  currentDayPublishedCount?: number | null;
  dailyTarget?: number | null;
}): BlogCurrentDayPublisherHealth {
  const now = params.now ?? new Date();
  const currentDay = kstDayKey(now);
  const { start, end } = kstDayRange(currentDay);
  const health = params.cronHealth ?? null;
  const lastRunAt = health?.last_run_at ?? null;
  const lastRunDate = lastRunAt ? new Date(lastRunAt) : null;
  const isCurrentDayRun = Boolean(
    lastRunDate
    && Number.isFinite(lastRunDate.getTime())
    && lastRunDate >= start
    && lastRunDate < end,
  );
  const summary = objectOrNull(health?.last_summary) ?? {};
  const errors = stringArray(summary.errors);
  const dailyQuota = objectOrNull(summary.dailyQuota) ?? {};
  const targetedPrivateRegeneration = summary.targetedPrivateRegeneration === true;
  const published = numberOrNull(summary.published);
  const remainingBeforeRun = numberOrNull(dailyQuota.remainingBeforeRun);
  const remainingAfterRun = numberOrNull(dailyQuota.remainingAfterRun);
  const lastStatus = health?.last_status ?? null;
  const lastErrorCount = typeof health?.last_error_count === 'number' ? health.last_error_count : 0;
  const failureBreakdown = objectOrNull(summary.failure_breakdown);
  const currentDayPublishedCount = numberOrNull(params.currentDayPublishedCount);
  const dailyTarget = numberOrNull(params.dailyTarget);

  const evidence = {
    current_day: currentDay,
    current_day_published_count: currentDayPublishedCount,
    daily_target: dailyTarget,
    last_run_at: lastRunAt,
    last_status: lastStatus,
    last_error_count: lastErrorCount,
    published,
    remaining_before_run: remainingBeforeRun,
    remaining_after_run: remainingAfterRun,
    errors,
    failure_breakdown: failureBreakdown,
    targeted_private_regeneration: targetedPrivateRegeneration,
  };

  if (!isCurrentDayRun) {
    return {
      status: 'healthy',
      code: null,
      detail: 'No current-day publisher failure has been observed.',
      evidence,
    };
  }

  if (
    currentDayPublishedCount !== null
    && dailyTarget !== null
    && dailyTarget > 0
    && currentDayPublishedCount >= dailyTarget
  ) {
    return {
      status: 'healthy',
      code: null,
      detail: 'Current KST day publish target has been met after the observed publisher run.',
      evidence,
    };
  }

  if (targetedPrivateRegeneration) {
    return {
      status: 'healthy',
      code: null,
      detail: 'The latest publisher record is a targeted private regeneration run, not a daily quota run.',
      evidence,
    };
  }

  const zeroPublishedWithRemaining = (
    (remainingBeforeRun ?? 0) > 0
    && published === 0
  ) || includesZeroPublishedSignal(summary, errors);

  if (zeroPublishedWithRemaining) {
    return {
      status: 'risk',
      code: 'current_day_publisher_zero_published',
      detail: `Current KST day publisher ran with remaining quota but published 0 post(s).`,
      evidence,
    };
  }

  const failed = lastStatus === 'error' || lastErrorCount > 0 || errors.length > 0;
  if (failed) {
    return {
      status: 'risk',
      code: 'current_day_publisher_failed',
      detail: `Current KST day publisher latest status is ${lastStatus ?? 'unknown'}.`,
      evidence,
    };
  }

  return {
    status: 'healthy',
    code: null,
    detail: 'Current-day publisher has no blocking failure signal.',
    evidence,
  };
}
