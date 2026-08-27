export const BLOG_PUBLICATION_RAMP_STAGES = ['pilot_3', 'ramp_10', 'max_30'] as const;

export type BlogPublicationRampStage = (typeof BLOG_PUBLICATION_RAMP_STAGES)[number];
export type BlogPublicationRolloutStatus = 'active' | 'frozen';
export type BlogPublicationRolloutDecision = 'hold' | 'promote' | 'demote' | 'freeze';

export const BLOG_PUBLICATION_RAMP_DEFINITIONS: Readonly<Record<
  BlogPublicationRampStage,
  {
    dailyCap: number;
    cumulativeSlotCaps: readonly [number, number, number, number, number];
    promotionHealthyWindows: number | null;
    promotionPublicationMinimum: number | null;
  }
>> = {
  pilot_3: {
    dailyCap: 3,
    cumulativeSlotCaps: [1, 1, 2, 2, 3],
    promotionHealthyWindows: 7,
    promotionPublicationMinimum: 14,
  },
  ramp_10: {
    dailyCap: 10,
    cumulativeSlotCaps: [2, 4, 6, 8, 10],
    promotionHealthyWindows: 7,
    promotionPublicationMinimum: 50,
  },
  max_30: {
    dailyCap: 30,
    cumulativeSlotCaps: [3, 8, 14, 22, 30],
    promotionHealthyWindows: null,
    promotionPublicationMinimum: null,
  },
} as const;

const STAGE_INDEX: Readonly<Record<BlogPublicationRampStage, number>> = {
  pilot_3: 0,
  ramp_10: 1,
  max_30: 2,
};

const REQUIRED_OBSERVATIONS = [
  'reviewBlockedOrHighRiskPublicCount',
  'dailyCapOrDuplicatePublicationViolationCount',
  'ineligibleSurfaceLeakCount',
  'publishedWithoutApprovedAttemptCount',
  'blog5xxLast15m',
  'aiCostCapExceeded',
  'controllerSuccessRate',
  'indexingEnqueueParity',
  'dbFallbackRate',
  'maxSnapshotLagMinutes',
  'searchCollectorFresh',
  'analyticsCollectorFresh',
  'candidateApprovalRateRecent100',
  'candidateSampleSizeRecent',
  'approvedInventoryCount',
  'verifiedBriefCount',
  'indexingDeadJobCount',
  'provenanceMismatchCount',
  'cannibalizationBlockerRate',
] as const;

export interface BlogPublicationRolloutState {
  scope: 'global';
  stage: BlogPublicationRampStage;
  status: BlogPublicationRolloutStatus;
  healthyWindowStreak: number;
  unhealthyWindowStreak: number;
  publicationsSinceStageStarted: number;
  stateVersion: number;
  stageStartedAt: string;
  lastEvaluatedAt: string | null;
  frozenAt: string | null;
  freezeReason: string | null;
}

export interface BlogPublicationRolloutSignals {
  reviewBlockedOrHighRiskPublicCount: number | null;
  dailyCapOrDuplicatePublicationViolationCount: number | null;
  ineligibleSurfaceLeakCount: number | null;
  publishedWithoutApprovedAttemptCount: number | null;
  blog5xxLast15m: number | null;
  aiCostCapExceeded: boolean | null;
  controllerSuccessRate: number | null;
  indexingEnqueueParity: number | null;
  dbFallbackRate: number | null;
  maxSnapshotLagMinutes: number | null;
  searchCollectorFresh: boolean | null;
  analyticsCollectorFresh: boolean | null;
  candidateApprovalRateRecent100: number | null;
  candidateSampleSizeRecent: number | null;
  approvedInventoryCount: number | null;
  verifiedBriefCount: number | null;
  indexingDeadJobCount: number | null;
  provenanceMismatchCount: number | null;
  cannibalizationBlockerRate: number | null;
}

export interface BlogPublicationRolloutEvaluation {
  decision: BlogPublicationRolloutDecision;
  stageBefore: BlogPublicationRampStage;
  stageAfter: BlogPublicationRampStage;
  statusBefore: BlogPublicationRolloutStatus;
  statusAfter: BlogPublicationRolloutStatus;
  healthyWindowStreakAfter: number;
  unhealthyWindowStreakAfter: number;
  publicationsSinceStageStartedAfter: number;
  observationComplete: boolean;
  severeIncident: boolean;
  reasons: string[];
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function nextStage(stage: BlogPublicationRampStage): BlogPublicationRampStage {
  if (stage === 'pilot_3') return 'ramp_10';
  return 'max_30';
}

function previousStage(stage: BlogPublicationRampStage): BlogPublicationRampStage {
  if (stage === 'max_30') return 'ramp_10';
  return 'pilot_3';
}

export function parseBlogPublicationRampStage(value: unknown): BlogPublicationRampStage {
  return BLOG_PUBLICATION_RAMP_STAGES.includes(value as BlogPublicationRampStage)
    ? value as BlogPublicationRampStage
    : 'pilot_3';
}

export function getBlogPublicationRampDefinition(stage: BlogPublicationRampStage) {
  return BLOG_PUBLICATION_RAMP_DEFINITIONS[stage];
}

export function lowerBlogPublicationRampStage(
  left: BlogPublicationRampStage,
  right: BlogPublicationRampStage,
): BlogPublicationRampStage {
  return STAGE_INDEX[left] <= STAGE_INDEX[right] ? left : right;
}

export function resolveEffectiveBlogPublicationRollout(input: {
  state: BlogPublicationRolloutState;
  environmentStageCeiling: BlogPublicationRampStage;
  environmentDailyCap: number;
}): {
  stage: BlogPublicationRampStage;
  dailyCap: number;
  cumulativeSlotCaps: readonly number[];
  frozen: boolean;
  reasons: string[];
} {
  const stage = lowerBlogPublicationRampStage(input.state.stage, input.environmentStageCeiling);
  const definition = getBlogPublicationRampDefinition(stage);
  const environmentDailyCap = Math.min(30, nonNegativeInteger(input.environmentDailyCap));
  const frozen = input.state.status === 'frozen';
  const dailyCap = frozen ? 0 : Math.min(environmentDailyCap, definition.dailyCap);
  const reasons: string[] = [];
  if (frozen) reasons.push('publication_rollout_frozen');
  if (stage !== input.state.stage) reasons.push('environment_stage_ceiling_applied');
  if (dailyCap < definition.dailyCap) reasons.push('environment_daily_cap_applied');

  return {
    stage,
    dailyCap,
    cumulativeSlotCaps: definition.cumulativeSlotCaps.map((value) => Math.min(value, dailyCap)),
    frozen,
    reasons,
  };
}

export function evaluateBlogPublicationRolloutWindow(input: {
  state: BlogPublicationRolloutState;
  signals: BlogPublicationRolloutSignals;
  publicationsObserved: number;
  autoRampEnabled: boolean;
  autoRollbackEnabled: boolean;
}): BlogPublicationRolloutEvaluation {
  const { state, signals } = input;
  const stageBefore = state.stage;
  const statusBefore = state.status;
  const observedPublications = nonNegativeInteger(input.publicationsObserved);
  const accumulatedPublications = state.publicationsSinceStageStarted + observedPublications;

  if (state.status === 'frozen') {
    return {
      decision: 'hold',
      stageBefore,
      stageAfter: stageBefore,
      statusBefore,
      statusAfter: 'frozen',
      healthyWindowStreakAfter: 0,
      unhealthyWindowStreakAfter: state.unhealthyWindowStreak,
      publicationsSinceStageStartedAfter: accumulatedPublications,
      observationComplete: false,
      severeIncident: true,
      reasons: ['publication_rollout_already_frozen', state.freezeReason].filter(Boolean) as string[],
    };
  }

  const severeReasons: string[] = [];
  if ((signals.reviewBlockedOrHighRiskPublicCount ?? 0) > 0) {
    severeReasons.push('unsafe_review_or_high_risk_publication');
  }
  if ((signals.dailyCapOrDuplicatePublicationViolationCount ?? 0) > 0) {
    severeReasons.push('daily_cap_or_duplicate_publication_violation');
  }
  if ((signals.ineligibleSurfaceLeakCount ?? 0) > 0) {
    severeReasons.push('ineligible_public_surface_leak');
  }
  if ((signals.publishedWithoutApprovedAttemptCount ?? 0) > 0) {
    severeReasons.push('publication_without_approved_attempt');
  }
  if ((signals.blog5xxLast15m ?? 0) >= 2) severeReasons.push('blog_5xx_threshold_exceeded');
  if (signals.aiCostCapExceeded === true) severeReasons.push('daily_ai_cost_cap_exceeded');
  if ((signals.indexingDeadJobCount ?? 0) > 0) severeReasons.push('indexing_dead_job_present');
  if ((signals.provenanceMismatchCount ?? 0) > 0) severeReasons.push('production_provenance_mismatch');

  if (severeReasons.length > 0) {
    return {
      decision: 'freeze',
      stageBefore,
      stageAfter: 'pilot_3',
      statusBefore,
      statusAfter: 'frozen',
      healthyWindowStreakAfter: 0,
      unhealthyWindowStreakAfter: state.unhealthyWindowStreak + 1,
      publicationsSinceStageStartedAfter: 0,
      observationComplete: true,
      severeIncident: true,
      reasons: severeReasons,
    };
  }

  const missingObservations = REQUIRED_OBSERVATIONS
    .filter((key) => signals[key] === null)
    .map((key) => `observation_missing:${key}`);
  if (missingObservations.length > 0) {
    return {
      decision: 'hold',
      stageBefore,
      stageAfter: stageBefore,
      statusBefore,
      statusAfter: statusBefore,
      healthyWindowStreakAfter: 0,
      unhealthyWindowStreakAfter: state.unhealthyWindowStreak,
      publicationsSinceStageStartedAfter: accumulatedPublications,
      observationComplete: false,
      severeIncident: false,
      reasons: missingObservations,
    };
  }

  const unhealthyReasons: string[] = [];
  if ((signals.controllerSuccessRate ?? 0) < 0.99) unhealthyReasons.push('controller_success_rate_below_99pct');
  if ((signals.indexingEnqueueParity ?? 0) < 1) unhealthyReasons.push('indexing_enqueue_parity_below_100pct');
  if ((signals.dbFallbackRate ?? 1) > 0.005) unhealthyReasons.push('database_fallback_rate_above_0_5pct');
  if ((signals.maxSnapshotLagMinutes ?? Number.POSITIVE_INFINITY) > 5) {
    unhealthyReasons.push('snapshot_refresh_lag_above_5m');
  }
  if (signals.searchCollectorFresh === false) unhealthyReasons.push('search_collector_not_fresh');
  if (signals.analyticsCollectorFresh === false) unhealthyReasons.push('analytics_collector_not_fresh');
  if ((signals.candidateSampleSizeRecent ?? 0) >= 100
    && (signals.candidateApprovalRateRecent100 ?? 0) < 0.7) {
    unhealthyReasons.push('candidate_approval_rate_below_70pct');
  }
  if ((signals.cannibalizationBlockerRate ?? 0) >= 0.05) {
    unhealthyReasons.push('cannibalization_blocker_rate_not_below_5pct');
  }

  if (unhealthyReasons.length > 0) {
    const unhealthyWindowStreakAfter = state.unhealthyWindowStreak + 1;
    const shouldDemote = input.autoRollbackEnabled
      && unhealthyWindowStreakAfter >= 2
      && stageBefore !== 'pilot_3';
    return {
      decision: shouldDemote ? 'demote' : 'hold',
      stageBefore,
      stageAfter: shouldDemote ? previousStage(stageBefore) : stageBefore,
      statusBefore,
      statusAfter: statusBefore,
      healthyWindowStreakAfter: 0,
      unhealthyWindowStreakAfter: shouldDemote ? 0 : unhealthyWindowStreakAfter,
      publicationsSinceStageStartedAfter: shouldDemote ? 0 : accumulatedPublications,
      observationComplete: true,
      severeIncident: false,
      reasons: shouldDemote
        ? ['two_consecutive_unhealthy_windows', ...unhealthyReasons]
        : unhealthyReasons,
    };
  }

  const healthyWindowStreakAfter = state.healthyWindowStreak + 1;
  const definition = getBlogPublicationRampDefinition(stageBefore);
  const max30ReadinessReasons = stageBefore === 'ramp_10'
    ? [
        ...((signals.candidateSampleSizeRecent ?? 0) < 100 ? ['recent_candidate_sample_below_100'] : []),
        ...((signals.candidateApprovalRateRecent100 ?? 0) < 0.7 ? ['candidate_approval_rate_below_70pct'] : []),
        ...((signals.approvedInventoryCount ?? 0) < 60 ? ['approved_inventory_below_60'] : []),
        ...((signals.verifiedBriefCount ?? 0) < 90 ? ['verified_brief_inventory_below_90'] : []),
        ...((signals.cannibalizationBlockerRate ?? 1) >= 0.05 ? ['cannibalization_blocker_rate_not_below_5pct'] : []),
      ]
    : [];
  const mayPromote = input.autoRampEnabled
    && definition.promotionHealthyWindows !== null
    && healthyWindowStreakAfter >= definition.promotionHealthyWindows
    && definition.promotionPublicationMinimum !== null
    && accumulatedPublications >= definition.promotionPublicationMinimum
    && max30ReadinessReasons.length === 0;

  return {
    decision: mayPromote ? 'promote' : 'hold',
    stageBefore,
    stageAfter: mayPromote ? nextStage(stageBefore) : stageBefore,
    statusBefore,
    statusAfter: statusBefore,
    healthyWindowStreakAfter: mayPromote ? 0 : healthyWindowStreakAfter,
    unhealthyWindowStreakAfter: 0,
    publicationsSinceStageStartedAfter: mayPromote ? 0 : accumulatedPublications,
    observationComplete: true,
    severeIncident: false,
    reasons: mayPromote
      ? ['promotion_health_window_and_volume_satisfied']
      : input.autoRampEnabled
        ? ['promotion_threshold_not_yet_satisfied', ...max30ReadinessReasons]
        : ['automatic_ramp_disabled'],
  };
}
