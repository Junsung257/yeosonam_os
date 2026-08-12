'use client';

export type FinanceAnalyticsEvent =
  | 'finance_workday_opened'
  | 'finance_task_opened'
  | 'finance_task_resolved'
  | 'finance_review_decision'
  | 'finance_next_item'
  | 'finance_close_blocked'
  | 'finance_close_completed'
  | 'finance_sync_result'
  | 'finance_error_shown';

type SafeValue = string | number | boolean | null;

const ALLOWED_PROPERTIES = new Set([
  'task_type', 'result', 'count_bucket', 'duration_bucket', 'viewport', 'month', 'error_code', 'decision', 'source',
]);

function countBucket(value: number): string {
  if (value <= 0) return '0';
  if (value === 1) return '1';
  if (value <= 5) return '2-5';
  if (value <= 20) return '6-20';
  return '21+';
}

export function financeCountBucket(value: number): string {
  return countBucket(Math.max(0, Math.round(value)));
}

export function trackFinanceEvent(event: FinanceAnalyticsEvent, properties: Record<string, SafeValue> = {}): void {
  if (typeof window === 'undefined') return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com').replace(/\/$/, '');
  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([name, value]) => ALLOWED_PROPERTIES.has(name) && ['string', 'number', 'boolean'].includes(typeof value)),
  );
  const payload = {
    api_key: key,
    event,
    properties: {
      ...safeProperties,
      distinct_id: 'finance-admin-anonymous',
      $process_person_profile: false,
      $lib: 'yeosonam-finance-manual',
    },
  };
  void fetch(`${host}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'omit',
  }).catch(() => undefined);
}
