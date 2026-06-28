import { describe, expect, it } from 'vitest';
import { evaluateAllScenarioReadiness } from './all-scenarios-readiness';

const PASSING_INPUT = {
  jarvisReadinessScore: 100,
  jarvisReadinessMaxScore: 100,
  jarvisReadinessStatus: 'pass' as const,
  customerInquiryScore: 100,
  customerInquiryStatus: 'pass' as const,
  autopilotHitlPassed: true,
  freeTravelScore: 100,
  freeTravelStatus: 'pass' as const,
  freeTravelP0Failures: 0,
  liveRagScore: 99,
  liveRagReadiness: 'ready' as const,
};

describe('all scenario readiness model', () => {
  it('passes when every weighted category clears the release threshold', () => {
    const summary = evaluateAllScenarioReadiness(PASSING_INPUT);

    expect(summary.status).toBe('pass');
    expect(summary.ok).toBe(true);
    expect(summary.score).toBe(100);
    expect(summary.blockingSections).toEqual([]);
  });

  it('fails when the weighted total drops below 95', () => {
    const summary = evaluateAllScenarioReadiness({
      ...PASSING_INPUT,
      autopilotHitlPassed: 'skipped',
    });

    expect(summary.status).toBe('fail');
    expect(summary.score).toBe(94);
  });

  it('fails on any free-travel P0 scenario failure even when score is above threshold', () => {
    const summary = evaluateAllScenarioReadiness({
      ...PASSING_INPUT,
      freeTravelScore: 99,
      freeTravelStatus: 'warn',
      freeTravelP0Failures: 1,
    });

    expect(summary.status).toBe('fail');
    expect(summary.blockingSections).toContain('free-travel-100');
  });
});
