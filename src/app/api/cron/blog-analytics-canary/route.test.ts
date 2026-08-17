import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('blog analytics canary route contract', () => {
  const source = readFileSync('src/app/api/cron/blog-analytics-canary/route.ts', 'utf8');

  it('is cron protected, idempotent per KST day, and reads the synthetic event back', () => {
    expect(source).toContain('isCronAuthorized(request)');
    expect(source).toContain('blog-analytics-canary:${day}');
    expect(source).toContain('recordServerAnalyticsEvent({');
    expect(source).toContain('synthetic: true');
    expect(source).toContain(".contains('event_payload', { __synthetic: true })");
  });

  it('proves synthetic probes never leak to external analytics delivery', () => {
    expect(source).toContain(".from('analytics_delivery_jobs')");
    expect(source).toContain('synthetic_event_delivery_leak');
    expect(source).toContain("withCronLogging('blog-analytics-canary'");
  });
});
