import { describe, expect, it } from 'vitest';
import { matchesPaymentPeriod } from './payment-period-filter';

const now = new Date('2026-08-15T12:00:00+09:00');

describe('matchesPaymentPeriod', () => {
  it('matches current and previous calendar months', () => {
    expect(matchesPaymentPeriod('2026-08-01', '이번 달', now)).toBe(true);
    expect(matchesPaymentPeriod('2026-07-31', '이번 달', now)).toBe(false);
    expect(matchesPaymentPeriod('2026-07-10', '지난 달', now)).toBe(true);
    expect(matchesPaymentPeriod('2026-06-30', '지난 달', now)).toBe(false);
  });

  it('matches the current and two preceding calendar months', () => {
    expect(matchesPaymentPeriod('2026-06-01', '3개월', now)).toBe(true);
    expect(matchesPaymentPeriod('2026-08-31', '3개월', now)).toBe(true);
    expect(matchesPaymentPeriod('2026-05-31', '3개월', now)).toBe(false);
  });

  it('keeps all rows for the all filter and rejects missing dates otherwise', () => {
    expect(matchesPaymentPeriod(undefined, '전체', now)).toBe(true);
    expect(matchesPaymentPeriod(undefined, '이번 달', now)).toBe(false);
  });

  it('uses Korea time at the UTC month boundary', () => {
    const koreaAugust = new Date('2026-07-31T15:30:00Z');

    expect(matchesPaymentPeriod('2026-08-01', '이번 달', koreaAugust)).toBe(true);
    expect(matchesPaymentPeriod('2026-07-31T15:00:00Z', '이번 달', koreaAugust)).toBe(true);
    expect(matchesPaymentPeriod('2026-07-31T14:59:59Z', '이번 달', koreaAugust)).toBe(false);
  });
});
