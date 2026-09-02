export type BlogProductionReadinessStatusV4 = 'pass' | 'warning' | 'block';
export type BlogProductionReadinessScopeV4 =
  | 'source'
  | 'schema'
  | 'delivery'
  | 'automation'
  | 'corpus'
  | 'measurement'
  | 'rollout';

export interface BlogProductionReadinessCheckV4 {
  key: string;
  scope: BlogProductionReadinessScopeV4;
  status: BlogProductionReadinessStatusV4;
  evidence: unknown;
  reason: string;
}

export interface BlogProductionReadinessInputV4 {
  source: {
    expectedBranch: string;
    productionBranch: string | null;
    expectedCommitSha: string;
    productionCommitSha: string | null;
  };
  release: {
    requiredForwardMigrations: string[];
    presentMigrations: string[];
    requiredCapabilities: string[];
    presentCapabilities: string[];
  };
  delivery: {
    publicEligible: number | null;
    currentSnapshots: number | null;
    missingSnapshotSlugs: string[] | null;
    publicSurfaceFailures: string[];
    databaseUnavailableErrorsSinceCandidateDeploy: number | null;
  };
  automation: {
    inngestEndpointReachable: boolean;
    mode: string | null;
    hasEventKey: boolean;
    hasSigningKey: boolean;
    functionCount: number | null;
    minimumFunctionCount: number;
    error: string | null;
  };
  corpus: {
    reviewBlockedPublished: number | null;
    reviewBlockedWithDisposition: number | null;
    queuedWithoutVerifiedDemand: number | null;
    dueQueuedWithoutVerifiedDemand: number | null;
  };
  measurement: {
    schemaReady: boolean;
    gscRows90d: number | null;
    gscLatestMetricDate: string | null;
    engagementRows7d: number | null;
    rumRows7d: number | null;
    analyticsCanaryPassedAt: string | null;
    naturalAttributedEvents30d: number | null;
    outboxDead: number | null;
  };
  rollout: {
    stateStoreReady: boolean;
    stage: 'pilot_3' | 'ramp_10' | 'max_30' | 'frozen' | null;
    frozen: boolean;
    dailyAiBudgetUsd: number | null;
    hardIncidentCount: number | null;
  };
}

export interface BlogProductionReadinessReportV4 {
  version: 'blog-production-readiness-v4';
  generatedAt: string;
  safeToEnableLive: boolean;
  checks: BlogProductionReadinessCheckV4[];
  scopes: Record<BlogProductionReadinessScopeV4, boolean>;
}

function ageInDays(value: string | null, now: Date): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function ageInCalendarDays(value: string | null, now: Date): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const metricDate = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(metricDate)) return null;
  const parsed = new Date(metricDate);
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - metricDate) / 86_400_000));
}

function check(
  key: string,
  scope: BlogProductionReadinessScopeV4,
  status: BlogProductionReadinessStatusV4,
  evidence: unknown,
  reason: string,
): BlogProductionReadinessCheckV4 {
  return { key, scope, status, evidence, reason };
}

export function evaluateBlogProductionReadinessV4(
  input: BlogProductionReadinessInputV4,
  now = new Date(),
): BlogProductionReadinessReportV4 {
  const missingForwardMigrations = input.release.requiredForwardMigrations.filter(
    (version) => !input.release.presentMigrations.includes(version),
  );
  const missingCapabilities = input.release.requiredCapabilities.filter(
    (capability) => !input.release.presentCapabilities.includes(capability),
  );
  const sourceMatches = input.source.productionBranch === input.source.expectedBranch
    && input.source.productionCommitSha === input.source.expectedCommitSha
    && /^[0-9a-f]{7,40}$/i.test(input.source.expectedCommitSha);
  const snapshotParity = input.delivery.publicEligible != null
    && input.delivery.currentSnapshots === input.delivery.publicEligible
    && input.delivery.missingSnapshotSlugs != null
    && input.delivery.missingSnapshotSlugs.length === 0;
  const dispositionsComplete = input.corpus.reviewBlockedPublished != null
    && input.corpus.reviewBlockedWithDisposition === input.corpus.reviewBlockedPublished;
  // Search Console exposes a date-granularity metric dimension. Comparing its
  // midnight timestamp with the current clock creates a false failure partway
  // through the third calendar day, so freshness must use calendar-day age.
  const gscAgeDays = ageInCalendarDays(input.measurement.gscLatestMetricDate, now);
  const analyticsCanaryAgeDays = ageInDays(input.measurement.analyticsCanaryPassedAt, now);
  const gscReady = (input.measurement.gscRows90d ?? 0) > 0
    && gscAgeDays != null
    && gscAgeDays <= 3;
  const analyticsCanaryReady = analyticsCanaryAgeDays != null && analyticsCanaryAgeDays <= 1;
  const rolloutReady = input.rollout.stateStoreReady
    && input.rollout.stage != null
    && !input.rollout.frozen
    && input.rollout.hardIncidentCount === 0
    && input.rollout.dailyAiBudgetUsd != null
    && input.rollout.dailyAiBudgetUsd > 0;
  const durableWorkflowReady = input.automation.inngestEndpointReachable
    && input.automation.mode === 'cloud'
    && input.automation.hasEventKey
    && input.automation.hasSigningKey
    && input.automation.functionCount != null
    && input.automation.functionCount >= input.automation.minimumFunctionCount;

  const checks: BlogProductionReadinessCheckV4[] = [
    check(
      'immutable_production_source',
      'source',
      sourceMatches ? 'pass' : 'block',
      input.source,
      sourceMatches ? 'production serves the reviewed immutable main commit' : 'production branch or commit does not match the release candidate',
    ),
    check(
      'forward_release_migrations',
      'schema',
      missingForwardMigrations.length === 0 ? 'pass' : 'block',
      { missingForwardMigrations },
      missingForwardMigrations.length === 0 ? 'all forward-only release migrations are recorded' : 'forward-only release migrations are missing',
    ),
    check(
      'semantic_runtime_capabilities',
      'schema',
      missingCapabilities.length === 0 ? 'pass' : 'block',
      { missingCapabilities },
      missingCapabilities.length === 0 ? 'all runtime capabilities are queryable' : 'one or more runtime capabilities are unavailable',
    ),
    check(
      'durable_snapshot_parity',
      'delivery',
      snapshotParity ? 'pass' : 'block',
      {
        publicEligible: input.delivery.publicEligible,
        currentSnapshots: input.delivery.currentSnapshots,
        missingSnapshotSlugs: input.delivery.missingSnapshotSlugs,
      },
      snapshotParity ? 'every eligible article has a current durable snapshot' : 'eligible articles and durable snapshots are not in exact parity',
    ),
    check(
      'public_surface_contract',
      'delivery',
      input.delivery.publicSurfaceFailures.length === 0 ? 'pass' : 'block',
      input.delivery.publicSurfaceFailures,
      input.delivery.publicSurfaceFailures.length === 0 ? 'all public surfaces passed' : 'one or more public surfaces failed',
    ),
    check(
      'candidate_runtime_reliability',
      'delivery',
      input.delivery.databaseUnavailableErrorsSinceCandidateDeploy === 0 ? 'pass' : 'block',
      input.delivery.databaseUnavailableErrorsSinceCandidateDeploy,
      input.delivery.databaseUnavailableErrorsSinceCandidateDeploy === 0
        ? 'no database-unavailable error occurred on the candidate deployment'
        : input.delivery.databaseUnavailableErrorsSinceCandidateDeploy == null
          ? 'candidate-deployment runtime error evidence is missing'
          : 'database-unavailable errors occurred on the candidate deployment',
    ),
    check(
      'durable_workflow_registration',
      'automation',
      durableWorkflowReady ? 'pass' : 'block',
      input.automation,
      durableWorkflowReady
        ? 'Inngest cloud credentials and all required functions are present on the candidate'
        : 'Inngest endpoint, cloud credentials, or required function registration is missing',
    ),
    check(
      'review_blocked_dispositions',
      'corpus',
      dispositionsComplete ? 'pass' : 'block',
      {
        published: input.corpus.reviewBlockedPublished,
        withDisposition: input.corpus.reviewBlockedWithDisposition,
      },
      dispositionsComplete ? 'every published review-blocked row has an explicit non-public disposition' : 'review-blocked published rows lack a complete disposition plan',
    ),
    check(
      'verified_demand_queue',
      'corpus',
      input.corpus.queuedWithoutVerifiedDemand === 0
        && input.corpus.dueQueuedWithoutVerifiedDemand === 0 ? 'pass' : 'block',
      {
        all: input.corpus.queuedWithoutVerifiedDemand,
        due: input.corpus.dueQueuedWithoutVerifiedDemand,
      },
      input.corpus.queuedWithoutVerifiedDemand === 0
        && input.corpus.dueQueuedWithoutVerifiedDemand === 0
        ? 'no queued topic bypasses verified demand'
        : 'queued topics without verified demand remain',
    ),
    check(
      'search_performance_freshness',
      'measurement',
      input.measurement.schemaReady && gscReady ? 'pass' : 'block',
      { rows90d: input.measurement.gscRows90d, latestMetricDate: input.measurement.gscLatestMetricDate, ageDays: gscAgeDays },
      input.measurement.schemaReady && gscReady ? 'recent observed GSC data is available' : 'GSC data is empty, stale, or unavailable',
    ),
    check(
      'engagement_and_rum_observation',
      'measurement',
      (input.measurement.engagementRows7d ?? 0) > 0 && (input.measurement.rumRows7d ?? 0) > 0 ? 'pass' : 'block',
      { engagement7d: input.measurement.engagementRows7d, rum7d: input.measurement.rumRows7d },
      (input.measurement.engagementRows7d ?? 0) > 0 && (input.measurement.rumRows7d ?? 0) > 0
        ? 'engagement and field performance observations are arriving'
        : 'engagement or field performance observations are absent',
    ),
    check(
      'analytics_end_to_end_canary',
      'measurement',
      analyticsCanaryReady && input.measurement.outboxDead === 0 ? 'pass' : 'block',
      { passedAt: input.measurement.analyticsCanaryPassedAt, ageDays: analyticsCanaryAgeDays, outboxDead: input.measurement.outboxDead },
      analyticsCanaryReady && input.measurement.outboxDead === 0
        ? 'a recent synthetic event traversed the analytics pipeline with no dead letters'
        : 'analytics end-to-end evidence is stale, missing, or has dead letters',
    ),
    check(
      'natural_conversion_observation',
      'measurement',
      (input.measurement.naturalAttributedEvents30d ?? 0) > 0 ? 'pass' : 'warning',
      input.measurement.naturalAttributedEvents30d,
      (input.measurement.naturalAttributedEvents30d ?? 0) > 0
        ? 'natural attributed events are observed'
        : 'no natural attributed event is observed yet; this does not invalidate the tested pipeline',
    ),
    check(
      'automatic_rollout_control',
      'rollout',
      rolloutReady ? 'pass' : 'block',
      input.rollout,
      rolloutReady ? 'automatic ramp, incident freeze, and a positive AI budget are active' : 'rollout state is missing, frozen, over incident threshold, or lacks a valid budget',
    ),
  ];

  const scopeNames: BlogProductionReadinessScopeV4[] = [
    'source', 'schema', 'delivery', 'automation', 'corpus', 'measurement', 'rollout',
  ];
  const scopes = Object.fromEntries(scopeNames.map((scope) => [
    scope,
    checks.filter((candidate) => candidate.scope === scope).every((candidate) => candidate.status !== 'block'),
  ])) as Record<BlogProductionReadinessScopeV4, boolean>;

  return {
    version: 'blog-production-readiness-v4',
    generatedAt: now.toISOString(),
    safeToEnableLive: Object.values(scopes).every(Boolean),
    checks,
    scopes,
  };
}
