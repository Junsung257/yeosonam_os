import { describe, expect, it } from 'vitest';

import {
  BLOG_PUBLICATION_RAMP_DEFINITIONS,
  evaluateBlogPublicationRolloutWindow,
  resolveEffectiveBlogPublicationRollout,
  type BlogPublicationRolloutSignals,
  type BlogPublicationRolloutState,
} from './blog-publication-rollout';

const healthySignals: BlogPublicationRolloutSignals = {
  reviewBlockedOrHighRiskPublicCount: 0,
  dailyCapOrDuplicatePublicationViolationCount: 0,
  ineligibleSurfaceLeakCount: 0,
  publishedWithoutApprovedAttemptCount: 0,
  blog5xxLast15m: 0,
  aiCostCapExceeded: false,
  controllerSuccessRate: 1,
  indexingEnqueueParity: 1,
  dbFallbackRate: 0,
  maxSnapshotLagMinutes: 2,
  searchCollectorFresh: true,
  analyticsCollectorFresh: true,
  candidateApprovalRateRecent100: 0.8,
  candidateSampleSizeRecent: 100,
  approvedInventoryCount: 60,
  verifiedBriefCount: 90,
  indexingDeadJobCount: 0,
  provenanceMismatchCount: 0,
  cannibalizationBlockerRate: 0.04,
};

function state(overrides: Partial<BlogPublicationRolloutState> = {}): BlogPublicationRolloutState {
  return {
    scope: 'global',
    stage: 'pilot_3',
    status: 'active',
    healthyWindowStreak: 0,
    unhealthyWindowStreak: 0,
    publicationsSinceStageStarted: 0,
    stateVersion: 1,
    stageStartedAt: '2026-08-16T00:00:00.000Z',
    lastEvaluatedAt: null,
    frozenAt: null,
    freezeReason: null,
    ...overrides,
  };
}

describe('blog publication rollout', () => {
  it('defines the reviewed cumulative KST slot caps', () => {
    expect(BLOG_PUBLICATION_RAMP_DEFINITIONS.pilot_3.cumulativeSlotCaps).toEqual([1, 1, 2, 2, 3]);
    expect(BLOG_PUBLICATION_RAMP_DEFINITIONS.ramp_10.cumulativeSlotCaps).toEqual([2, 4, 6, 8, 10]);
    expect(BLOG_PUBLICATION_RAMP_DEFINITIONS.max_30.cumulativeSlotCaps).toEqual([3, 8, 14, 22, 30]);
  });

  it('applies both the environment stage and daily hard ceilings', () => {
    expect(resolveEffectiveBlogPublicationRollout({
      state: state({ stage: 'max_30' }),
      environmentStageCeiling: 'ramp_10',
      environmentDailyCap: 7,
    })).toMatchObject({
      stage: 'ramp_10',
      dailyCap: 7,
      cumulativeSlotCaps: [2, 4, 6, 7, 7],
    });
  });

  it('freezes immediately and resets to the pilot stage on a severe incident', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({ stage: 'max_30' }),
      signals: { ...healthySignals, publishedWithoutApprovedAttemptCount: 1 },
      publicationsObserved: 4,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });

    expect(result).toMatchObject({
      decision: 'freeze',
      stageAfter: 'pilot_3',
      statusAfter: 'frozen',
      severeIncident: true,
    });
    expect(result.reasons).toContain('publication_without_approved_attempt');
  });

  it('does not promote when any required observation is missing', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({ healthyWindowStreak: 6, publicationsSinceStageStarted: 20 }),
      signals: { ...healthySignals, dbFallbackRate: null },
      publicationsObserved: 3,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });

    expect(result).toMatchObject({
      decision: 'hold',
      stageAfter: 'pilot_3',
      observationComplete: false,
      healthyWindowStreakAfter: 0,
    });
    expect(result.reasons).toContain('observation_missing:dbFallbackRate');
  });

  it('promotes pilot to ramp_10 only after seven healthy windows and 14 publications', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({ healthyWindowStreak: 6, publicationsSinceStageStarted: 12 }),
      signals: healthySignals,
      publicationsObserved: 2,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });

    expect(result).toMatchObject({
      decision: 'promote',
      stageAfter: 'ramp_10',
      healthyWindowStreakAfter: 0,
      publicationsSinceStageStartedAfter: 0,
    });
  });

  it('promotes ramp_10 to max_30 only after seven healthy windows and 50 publications', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({
        stage: 'ramp_10', healthyWindowStreak: 6, publicationsSinceStageStarted: 41,
      }),
      signals: healthySignals,
      publicationsObserved: 9,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });

    expect(result).toMatchObject({ decision: 'promote', stageAfter: 'max_30' });
  });

  it('holds ramp_10 when max_30 inventory evidence is insufficient', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({ stage: 'ramp_10', healthyWindowStreak: 6, publicationsSinceStageStarted: 50 }),
      signals: { ...healthySignals, approvedInventoryCount: 59 },
      publicationsObserved: 10,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });
    expect(result).toMatchObject({ decision: 'hold', stageAfter: 'ramp_10' });
    expect(result.reasons).toContain('approved_inventory_below_60');
  });

  it('freezes immediately on provenance mismatch or an indexing dead job', () => {
    for (const signals of [
      { ...healthySignals, provenanceMismatchCount: 1 },
      { ...healthySignals, indexingDeadJobCount: 1 },
    ]) {
      expect(evaluateBlogPublicationRolloutWindow({
        state: state({ stage: 'ramp_10' }), signals, publicationsObserved: 0,
        autoRampEnabled: true, autoRollbackEnabled: true,
      })).toMatchObject({ decision: 'freeze', stageAfter: 'pilot_3' });
    }
  });

  it('demotes one stage only after two consecutive unhealthy windows', () => {
    const unhealthy = { ...healthySignals, indexingEnqueueParity: 0.98 };
    const first = evaluateBlogPublicationRolloutWindow({
      state: state({ stage: 'max_30' }),
      signals: unhealthy,
      publicationsObserved: 20,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });
    expect(first).toMatchObject({ decision: 'hold', stageAfter: 'max_30', unhealthyWindowStreakAfter: 1 });

    const second = evaluateBlogPublicationRolloutWindow({
      state: state({ stage: 'max_30', unhealthyWindowStreak: 1 }),
      signals: unhealthy,
      publicationsObserved: 20,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });
    expect(second).toMatchObject({ decision: 'demote', stageAfter: 'ramp_10', unhealthyWindowStreakAfter: 0 });
  });

  it('keeps a frozen state frozen until an explicit operational recovery', () => {
    const result = evaluateBlogPublicationRolloutWindow({
      state: state({ status: 'frozen', freezeReason: 'unsafe_publication' }),
      signals: healthySignals,
      publicationsObserved: 0,
      autoRampEnabled: true,
      autoRollbackEnabled: true,
    });
    expect(result).toMatchObject({ decision: 'hold', statusAfter: 'frozen' });
  });
});
