import { describe, expect, it } from 'vitest';
import { getClosedKstDailySummaryRange } from '@/lib/blog-daily-summary-window';

describe('blog daily summary report day', () => {
  it('reports the previous KST day before the 22:12 close window', () => {
    const range = getClosedKstDailySummaryRange(new Date('2026-06-30T15:39:31.443Z'));

    expect(range.dayKey).toBe('2026-06-30');
    expect(range.usedPreviousDay).toBe(true);
    expect(range.closeMinuteKst).toBe(22 * 60 + 12);
  });

  it('reports the current KST day after the 22:12 close window', () => {
    const range = getClosedKstDailySummaryRange(new Date('2026-07-01T13:20:00.000Z'));

    expect(range.dayKey).toBe('2026-07-01');
    expect(range.usedPreviousDay).toBe(false);
  });
});
