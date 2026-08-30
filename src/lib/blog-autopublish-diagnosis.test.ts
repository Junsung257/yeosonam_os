import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyBlogAutopublishDiagnosisBuckets } from './blog-autopublish-diagnosis';

describe('blog autopublish diagnosis bucket classification', () => {
  it('keeps past missed-day evidence but removes it from active risk when today is healthy', () => {
    const result = classifyBlogAutopublishDiagnosisBuckets(
      [
        { code: 'daily_publish_sla_miss', severity: 'critical', detail: '2026-07-08 missed target' },
        { code: 'publisher_timeout', severity: 'high', detail: 'historical timeout runs' },
      ],
      {
        reportDay: '2026-07-08',
        currentDay: '2026-07-09',
        currentDayPublished: 4,
        dailyTarget: 4,
        currentDayPublisherHealthy: true,
        publishPreflightBlocked: false,
        candidateShortage: false,
      },
    );

    expect(result.operating_status).toBe('healthy');
    expect(result.active_buckets).toHaveLength(0);
    expect(result.historical_buckets.map((bucket) => bucket.code)).toEqual([
      'daily_publish_sla_miss',
      'publisher_timeout',
    ]);
  });

  it('keeps past SLA evidence historical even when candidate buffer needs refill', () => {
    const result = classifyBlogAutopublishDiagnosisBuckets(
      [
        { code: 'daily_publish_sla_miss', severity: 'critical', detail: '2026-07-26 missed target' },
        { code: 'candidate_shortage', severity: 'warning', detail: 'buffer below target' },
      ],
      {
        reportDay: '2026-07-26',
        currentDay: '2026-07-27',
        currentDayPublished: 7,
        dailyTarget: 5,
        currentDayPublisherHealthy: true,
        publishPreflightBlocked: false,
        candidateShortage: true,
      },
    );

    expect(result.operating_status).toBe('watch');
    expect(result.active_buckets.map((bucket) => bucket.code)).toEqual(['candidate_shortage']);
    expect(result.historical_buckets.map((bucket) => bucket.code)).toEqual(['daily_publish_sla_miss']);
  });

  it('keeps current-day failures active even when the code matches a historical bucket', () => {
    const result = classifyBlogAutopublishDiagnosisBuckets(
      [{ code: 'daily_publish_sla_miss', severity: 'critical', detail: 'today missed target' }],
      {
        reportDay: '2026-07-09',
        currentDay: '2026-07-09',
        currentDayPublished: 0,
        dailyTarget: 4,
        currentDayPublisherHealthy: false,
        publishPreflightBlocked: false,
        candidateShortage: false,
      },
    );

    expect(result.operating_status).toBe('risk');
    expect(result.active_buckets.map((bucket) => bucket.code)).toEqual(['daily_publish_sla_miss']);
    expect(result.historical_buckets).toHaveLength(0);
  });

  it('does not hide non-historical active blockers behind a healthy current day', () => {
    const result = classifyBlogAutopublishDiagnosisBuckets(
      [{ code: 'candidate_shortage', severity: 'critical', detail: 'not enough candidates' }],
      {
        reportDay: '2026-07-08',
        currentDay: '2026-07-09',
        currentDayPublished: 4,
        dailyTarget: 4,
        currentDayPublisherHealthy: true,
        publishPreflightBlocked: false,
        candidateShortage: false,
      },
    );

    expect(result.operating_status).toBe('risk');
    expect(result.active_buckets.map((bucket) => bucket.code)).toEqual(['candidate_shortage']);
  });

  it('keeps closed-day SLA evidence separate from current-day quota status in the operator report', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/diagnose-blog-autopublish.ts'), 'utf8');

    expect(source).toContain('closed_day:');
    expect(source).toContain('current_day_status:');
    expect(source).toContain('Closed day:');
    expect(source).toContain('Current day:');
    expect(source).toContain('selected_because');
    expect(source).toContain('quota_met');
    expect(source).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
    expect(source).toContain("source: 'public_eligibility_view'");
    expect(source).toContain('published: input.rawPublished');
    expect(source).not.toContain("{ source: 'blog_daily_summary', value: input.dailySummaryPublished }");
  });

  it('surfaces fleet-level phrase drift in the operator diagnosis', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/diagnose-blog-autopublish.ts'), 'utf8');

    expect(source).toContain('inspectBlogFleetPhraseDrift');
    expect(source).toContain("code: 'fleet_phrase_drift'");
    expect(source).toContain('fleet_phrase_drift: fleetPhraseDrift');
    expect(source).toContain('Fleet phrase drift:');
  });
});
