import { describe, expect, it } from 'vitest';
import {
  buildBlogGscCollectionPlanV3,
  readBlogGscBackfillCursorV3,
} from './blog-gsc-collection-plan-v3';

describe('durable GSC collection plan', () => {
  it('collects a seven-day catchup plus only one bounded backfill chunk', () => {
    const plan = buildBlogGscCollectionPlanV3({
      now: new Date('2026-08-16T12:00:00.000Z'),
      catchupDays: 7,
      backfillDays: 90,
      backfillChunkDays: 7,
    });
    expect(plan.catchupDates).toEqual([
      '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11',
      '2026-08-12', '2026-08-13', '2026-08-14',
    ]);
    expect(plan.backfillDates).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
      '2026-08-05', '2026-08-06', '2026-08-07',
    ]);
    expect(plan.requestedDates).toHaveLength(14);
    expect(plan.nextBackfillEndDate).toBe('2026-07-31');
  });

  it('resumes from the previous durable cursor and stops at the 90-day boundary', () => {
    const plan = buildBlogGscCollectionPlanV3({
      now: new Date('2026-08-16T12:00:00.000Z'),
      previousBackfillEndDate: '2026-05-17',
      hasPreviousState: true,
      backfillChunkDays: 7,
    });
    expect(plan.windowStartDate).toBe('2026-05-17');
    expect(plan.backfillDates).toEqual(['2026-05-17']);
    expect(plan.nextBackfillEndDate).toBeNull();
  });

  it('reads the newest valid cursor from cron summaries', () => {
    expect(readBlogGscBackfillCursorV3([
      { summary: { gsc_collection: { nextBackfillEndDate: 'invalid' } } },
      { summary: { gsc_collection: { nextBackfillEndDate: '2026-07-31' } } },
    ])).toBe('2026-07-31');
  });
});
