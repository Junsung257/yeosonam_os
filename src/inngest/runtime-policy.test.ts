import { afterEach, describe, expect, it } from 'vitest';

import {
  billingPeriodFromTimestamp,
  buildInngestEventId,
  isInngestBillingEnabled,
  isInngestScheduleExecutionEnabled,
  nextBillingDateFromPeriod,
  utcDayFromTimestamp,
} from '@/inngest/runtime-policy';

const originalSchedules = process.env.INNGEST_SCHEDULES_ENABLED;
const originalBilling = process.env.INNGEST_BILLING_ENABLED;

afterEach(() => {
  if (originalSchedules === undefined) delete process.env.INNGEST_SCHEDULES_ENABLED;
  else process.env.INNGEST_SCHEDULES_ENABLED = originalSchedules;
  if (originalBilling === undefined) delete process.env.INNGEST_BILLING_ENABLED;
  else process.env.INNGEST_BILLING_ENABLED = originalBilling;
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
