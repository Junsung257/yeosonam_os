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

  it('treats an earlier zero-publish run as recovered when the current-day target is already met', () => {
    const health = evaluateCurrentDayPublisherHealth({
      now: new Date('2026-07-03T05:30:00.000Z'),
      currentDayPublishedCount: 4,
      dailyTarget: 4,
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

    expect(health.status).toBe('healthy');
    expect(health.code).toBeNull();
    expect(health.evidence.current_day_published_count).toBe(4);
    expect(health.detail).toContain('target has been met');
  });

  it('does not let targeted private regeneration failures replace daily quota health', () => {
    const health = evaluateCurrentDayPublisherHealth({
      now: new Date('2026-07-30T07:20:00.000Z'),
      currentDayPublishedCount: 3,
      dailyTarget: 5,
      cronHealth: {
        last_status: 'partial_failure',
        last_run_at: '2026-07-30T07:10:45.796+00:00',
        last_error_count: 1,
        last_summary: {
          targetedPrivateRegeneration: true,
          processed: 1,
          published: 0,
          errors: ['private_regeneration_request_invalid'],
        },
      },
    });

    expect(health.status).toBe('healthy');
    expect(health.code).toBeNull();
    expect(health.evidence.targeted_private_regeneration).toBe(true);
    expect(health.detail).toContain('targeted private regeneration');
  });
});
