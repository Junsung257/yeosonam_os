import { getSecret } from '@/lib/secret-registry';

function enabled(value: string | null): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * Inngest scheduled side effects stay fail-closed until production has both
 * Inngest credentials and an explicit cutover from the equivalent Vercel cron.
 */
export function isInngestScheduleExecutionEnabled(): boolean {
  return enabled(getSecret('INNGEST_SCHEDULES_ENABLED'));
}

/** Monthly billing requires a separate, narrower approval even after cutover. */
export function isInngestBillingEnabled(): boolean {
  return isInngestScheduleExecutionEnabled() && enabled(getSecret('INNGEST_BILLING_ENABLED'));
}

/** Blog cutover is independent from marketing/billing and remains fail-closed. */
export function isInngestBlogAutopilotEnabled(): boolean {
  return enabled(getSecret('INNGEST_BLOG_AUTOPILOT_ENABLED'));
}

export function utcDayFromTimestamp(timestamp?: number): string {
  const date = new Date(typeof timestamp === 'number' ? timestamp : Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('invalid Inngest timestamp');
  return date.toISOString().slice(0, 10);
}

export function billingPeriodFromTimestamp(timestamp?: number): string {
  return `${utcDayFromTimestamp(timestamp).slice(0, 7)}-01`;
}

export function nextBillingDateFromPeriod(period: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-01$/u.test(period)) {
    throw new Error('invalid billing period');
  }
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export function buildInngestEventId(prefix: string, subjectId: string, period: string): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const normalizedSubject = subjectId.replace(/[^a-z0-9-]/gi, '-').slice(0, 64);
  const normalizedPeriod = period.replace(/[^0-9-]/g, '').slice(0, 10);
  return `${normalizedPrefix}:${normalizedSubject}:${normalizedPeriod}`;
}
