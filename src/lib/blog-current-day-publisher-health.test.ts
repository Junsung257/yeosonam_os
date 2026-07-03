import { describe, expect, it } from 'vitest';
import { evaluateCurrentDayPublisherHealth } from './blog-current-day-publisher-health';

describe('evaluateCurrentDayPublisherHealth', () => {
  it('flags current-day zero publish runs even before daily close reports switch to today', () => {
    const health = evaluateCurrentDayPublisherHealth({
      now: new Date('2026-07-03T03:25:00.000Z'),
      cronHealth: {
        last_status: 'error',
        last_run_at: '2026-07-03T03:05:46.325+00:00',
        last_error_count: 5,
        last_summary: {
          errors: ['publisher_zero_published_with_remaining_quota'],
          published: 0,
          dailyQuota: {
            day: '2026-07-03',
            target: 4,
            remainingBeforeRun: 4,
            remainingAfterRun: 4,
          },
        },
      },
    });

    expect(health.status).toBe('risk');
    expect(health.code).toBe('current_day_publisher_zero_published');
    expect(health.evidence.current_day).toBe('2026-07-03');
    expect(health.evidence.remaining_before_run).toBe(4);
  });

  it('ignores stale previous-day publisher failures for current-day health', () => {
    const health = evaluateCurrentDayPublisherHealth({
      now: new Date('2026-07-03T03:25:00.000Z'),
      cronHealth: {
        last_status: 'error',
        last_run_at: '2026-07-02T03:05:46.325+00:00',
        last_error_count: 5,
        last_summary: {
          errors: ['publisher_zero_published_with_remaining_quota'],
          published: 0,
          dailyQuota: {
            remainingBeforeRun: 4,
            remainingAfterRun: 4,
          },
        },
      },
    });

    expect(health.status).toBe('healthy');
    expect(health.code).toBeNull();
  });

  it('keeps successful current-day quota-reached noops healthy', () => {
    const health = evaluateCurrentDayPublisherHealth({
      now: new Date('2026-07-03T14:25:00.000Z'),
      cronHealth: {
        last_status: 'success',
        last_run_at: '2026-07-03T14:20:00.000+00:00',
        last_error_count: 0,
        last_summary: {
          errors: [],
          reason: 'daily_publish_quota_reached',
          skipped: true,
          published: 0,
          dailyQuota: {
            day: '2026-07-03',
            target: 4,
            remaining: 0,
            alreadyPublished: 4,
          },
        },
      },
    });

    expect(health.status).toBe('healthy');
    expect(health.code).toBeNull();
  });
});
