import { describe, expect, it, vi } from 'vitest';
import {
  loadBlogPublicationRolloutState,
  persistBlogPublicationRolloutEvaluation,
} from './blog-publication-rollout-repository';

describe('blog publication rollout repository', () => {
  it('fails closed when the durable state is missing', async () => {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    };
    await expect(loadBlogPublicationRolloutState(client as never)).resolves.toEqual({
      state: null,
      error: 'rollout_state_missing',
    });
  });

  it('persists the expected state version and complete signal evidence through one RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const result = await persistBlogPublicationRolloutEvaluation({
      client: { rpc } as never,
      state: {
        scope: 'global', stage: 'pilot_3', status: 'active', healthyWindowStreak: 0,
        unhealthyWindowStreak: 0, publicationsSinceStageStarted: 0, stateVersion: 4,
        stageStartedAt: '2026-08-10T00:00:00Z', lastEvaluatedAt: null, frozenAt: null, freezeReason: null,
      },
      evaluation: {
        decision: 'hold', stageBefore: 'pilot_3', stageAfter: 'pilot_3',
        statusBefore: 'active', statusAfter: 'active', healthyWindowStreakAfter: 1,
        unhealthyWindowStreakAfter: 0, publicationsSinceStageStartedAfter: 3,
        observationComplete: true, severeIncident: false, reasons: ['promotion_threshold_not_yet_satisfied'],
      },
      windowKey: '2026-08-15',
      publicationsObserved: 3,
      signals: {
        reviewBlockedOrHighRiskPublicCount: 0, dailyCapOrDuplicatePublicationViolationCount: 0,
        ineligibleSurfaceLeakCount: 0, publishedWithoutApprovedAttemptCount: 0,
        blog5xxLast15m: 0, aiCostCapExceeded: false, controllerSuccessRate: 1,
        indexingEnqueueParity: 1, dbFallbackRate: 0, maxSnapshotLagMinutes: 1,
        searchCollectorFresh: true, analyticsCollectorFresh: true,
        candidateApprovalRateRecent100: 0.8, candidateSampleSizeRecent: 100,
        approvedInventoryCount: 60, verifiedBriefCount: 90,
        indexingDeadJobCount: 0, provenanceMismatchCount: 0,
        cannibalizationBlockerRate: 0.04,
      },
    });
    expect(result).toEqual({ persisted: true, error: null });
    expect(rpc).toHaveBeenCalledWith('apply_blog_publication_rollout_evaluation_v1', expect.objectContaining({
      p_expected_state_version: 4,
      p_window_key: '2026-08-15',
      p_publications_observed: 3,
    }));
  });
});
