import { describe, expect, it } from 'vitest';
import { evaluateBlogDataReadinessV3 } from './blog-data-readiness-v3';

describe('blog data readiness v3', () => {
  it('treats missing and zero measurement data as an error, never success', () => {
    const report = evaluateBlogDataReadinessV3({
      searchPerformance30d: 0,
      engagement7d: null,
      serverEvents30d: 0,
      rum7d: 0,
      currentSnapshots: 192,
      outboxDead: 0,
      outboxReady: 0,
    }, new Date('2026-08-12T00:00:00.000Z'));
    expect(report.status).toBe('critical');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'searchPerformance30d', reason: 'zero_observed_rows' }),
      expect.objectContaining({ metric: 'engagement7d', reason: 'query_unavailable' }),
      expect.objectContaining({ metric: 'serverEvents30d', status: 'warning', reason: 'no_natural_attributed_events_yet' }),
    ]));
  });

  it('does not claim a broken pipeline solely because natural attributed conversions are not observed yet', () => {
    const report = evaluateBlogDataReadinessV3({
      searchPerformance30d: 1,
      engagement7d: 1,
      serverEvents30d: 0,
      rum7d: 1,
      currentSnapshots: 1,
      outboxDead: 0,
      outboxReady: 0,
    });
    expect(report.status).toBe('warning');
  });

  it('reports readiness only when every required source has observed rows', () => {
    expect(evaluateBlogDataReadinessV3({
      searchPerformance30d: 120,
      engagement7d: 80,
      serverEvents30d: 3,
      rum7d: 40,
      currentSnapshots: 192,
      outboxDead: 0,
      outboxReady: 2,
    }).status).toBe('ok');
  });

  it('escalates dead letters and warns on a large ready backlog', () => {
    const base = {
      searchPerformance30d: 1,
      engagement7d: 1,
      serverEvents30d: 1,
      rum7d: 1,
      currentSnapshots: 1,
    };
    expect(evaluateBlogDataReadinessV3({ ...base, outboxDead: 1, outboxReady: 0 }).status).toBe('critical');
    expect(evaluateBlogDataReadinessV3({ ...base, outboxDead: 0, outboxReady: 101 }).status).toBe('warning');
  });
});
