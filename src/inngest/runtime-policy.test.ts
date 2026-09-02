import { afterEach, describe, expect, it } from 'vitest';

import {
  billingPeriodFromTimestamp,
  buildInngestEventId,
  isInngestBlogAutopilotConfigured,
  isInngestBlogAutopilotEnabled,
  isInngestBillingEnabled,
  isInngestScheduleExecutionEnabled,
  nextBillingDateFromPeriod,
  utcDayFromTimestamp,
} from '@/inngest/runtime-policy';

const originalSchedules = process.env.INNGEST_SCHEDULES_ENABLED;
const originalBilling = process.env.INNGEST_BILLING_ENABLED;
const originalBlogAutopilot = process.env.INNGEST_BLOG_AUTOPILOT_ENABLED;
const originalEventKey = process.env.INNGEST_EVENT_KEY;
const originalSigningKey = process.env.INNGEST_SIGNING_KEY;

afterEach(() => {
  if (originalSchedules === undefined) delete process.env.INNGEST_SCHEDULES_ENABLED;
  else process.env.INNGEST_SCHEDULES_ENABLED = originalSchedules;
  if (originalBilling === undefined) delete process.env.INNGEST_BILLING_ENABLED;
  else process.env.INNGEST_BILLING_ENABLED = originalBilling;
  if (originalBlogAutopilot === undefined) delete process.env.INNGEST_BLOG_AUTOPILOT_ENABLED;
  else process.env.INNGEST_BLOG_AUTOPILOT_ENABLED = originalBlogAutopilot;
  if (originalEventKey === undefined) delete process.env.INNGEST_EVENT_KEY;
  else process.env.INNGEST_EVENT_KEY = originalEventKey;
  if (originalSigningKey === undefined) delete process.env.INNGEST_SIGNING_KEY;
  else process.env.INNGEST_SIGNING_KEY = originalSigningKey;
});

describe('Inngest runtime policy', () => {
  it('keeps scheduled side effects fail-closed by default', () => {
    delete process.env.INNGEST_SCHEDULES_ENABLED;
    process.env.INNGEST_BILLING_ENABLED = '1';

    expect(isInngestScheduleExecutionEnabled()).toBe(false);
    expect(isInngestBillingEnabled()).toBe(false);
  });

  it('requires both the schedule cutover and billing approval', () => {
    process.env.INNGEST_SCHEDULES_ENABLED = 'true';
    process.env.INNGEST_BILLING_ENABLED = '1';

    expect(isInngestScheduleExecutionEnabled()).toBe(true);
    expect(isInngestBillingEnabled()).toBe(true);
  });

  it('distinguishes a requested blog cutover from a runnable Inngest connection', () => {
    process.env.INNGEST_BLOG_AUTOPILOT_ENABLED = 'true';
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;

    expect(isInngestBlogAutopilotEnabled()).toBe(true);
    expect(isInngestBlogAutopilotConfigured()).toBe(false);

    process.env.INNGEST_EVENT_KEY = 'event-key';
    expect(isInngestBlogAutopilotConfigured()).toBe(false);
    process.env.INNGEST_SIGNING_KEY = 'signkey-test';
    expect(isInngestBlogAutopilotConfigured()).toBe(true);
  });

  it('builds stable periods and event ids from the scheduled timestamp', () => {
    const timestamp = Date.parse('2026-08-31T00:20:00.000Z');

    expect(utcDayFromTimestamp(timestamp)).toBe('2026-08-31');
    expect(billingPeriodFromTimestamp(timestamp)).toBe('2026-08-01');
    expect(nextBillingDateFromPeriod('2026-08-01')).toBe('2026-09-01');
    expect(nextBillingDateFromPeriod('2026-12-01')).toBe('2027-01-01');
    expect(buildInngestEventId('billing tenant', 'tenant/one', '2026-08-01'))
      .toBe('billing-tenant:tenant-one:2026-08-01');
  });

  it('rejects malformed billing periods instead of drifting from execution time', () => {
    expect(() => nextBillingDateFromPeriod('2026-08-31')).toThrow('invalid billing period');
  });
});
