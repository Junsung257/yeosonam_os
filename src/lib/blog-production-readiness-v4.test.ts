import { describe, expect, it } from 'vitest';
import {
  evaluateBlogProductionReadinessV4,
  type BlogProductionReadinessInputV4,
} from './blog-production-readiness-v4';

const now = new Date('2026-08-16T03:00:00.000Z');
const readyInput = (): BlogProductionReadinessInputV4 => ({
  source: {
    expectedBranch: 'main',
    productionBranch: 'main',
    expectedCommitSha: 'abcdef1234567890',
    productionCommitSha: 'abcdef1234567890',
  },
  release: {
    requiredForwardMigrations: ['20260816000100'],
    presentMigrations: ['20260816000100'],
    requiredCapabilities: ['generation_attempt_finish_reason', 'rollout_state'],
    presentCapabilities: ['generation_attempt_finish_reason', 'rollout_state'],
  },
  delivery: {
    publicEligible: 191,
    currentSnapshots: 191,
    missingSnapshotSlugs: [],
    publicSurfaceFailures: [],
    databaseUnavailableErrorsSinceCandidateDeploy: 0,
  },
  automation: {
    inngestEndpointReachable: true,
    mode: 'cloud',
    hasEventKey: true,
    hasSigningKey: true,
    functionCount: 5,
    minimumFunctionCount: 5,
    error: null,
  },
  corpus: {
    reviewBlockedPublished: 8,
    reviewBlockedWithDisposition: 8,
    queuedWithoutVerifiedDemand: 0,
    dueQueuedWithoutVerifiedDemand: 0,
  },
  measurement: {
    schemaReady: true,
    gscRows90d: 198,
    gscLatestMetricDate: '2026-08-15',
    engagementRows7d: 1479,
    rumRows7d: 3642,
    analyticsCanaryPassedAt: '2026-08-16T02:45:00.000Z',
    naturalAttributedEvents30d: 0,
    outboxDead: 0,
  },
  rollout: {
    stateStoreReady: true,
    stage: 'pilot_3',
    frozen: false,
    dailyAiBudgetUsd: 2,
    hardIncidentCount: 0,
  },
});

describe('blog production readiness v4', () => {
  it('permits live pilot when every safety boundary has direct evidence', () => {
    const report = evaluateBlogProductionReadinessV4(readyInput(), now);
    expect(report.safeToEnableLive).toBe(true);
    expect(Object.values(report.scopes).every(Boolean)).toBe(true);
    expect(report.checks.find((item) => item.key === 'natural_conversion_observation')?.status)
      .toBe('warning');
  });

  it('uses semantic capabilities and only the forward release marker', () => {
    const input = readyInput();
    input.release.presentMigrations = [];
    input.release.presentCapabilities = ['generation_attempt_finish_reason'];
    const report = evaluateBlogProductionReadinessV4(input, now);
    expect(report.safeToEnableLive).toBe(false);
    expect(report.checks.find((item) => item.key === 'forward_release_migrations'))
      .toMatchObject({ status: 'block', evidence: { missingForwardMigrations: ['20260816000100'] } });
    expect(report.checks.find((item) => item.key === 'semantic_runtime_capabilities'))
      .toMatchObject({ status: 'block', evidence: { missingCapabilities: ['rollout_state'] } });
  });

  it('does not mistake old production errors for candidate-deployment evidence', () => {
    const input = readyInput();
    input.delivery.databaseUnavailableErrorsSinceCandidateDeploy = null;
    expect(evaluateBlogProductionReadinessV4(input, now).safeToEnableLive).toBe(false);
    input.delivery.databaseUnavailableErrorsSinceCandidateDeploy = 1;
    expect(evaluateBlogProductionReadinessV4(input, now).safeToEnableLive).toBe(false);
  });

  it('blocks a requested cutover when either Inngest credential or registration is missing', () => {
    const input = readyInput();
    input.automation.hasEventKey = false;
    input.automation.functionCount = 4;
    const report = evaluateBlogProductionReadinessV4(input, now);
    expect(report.scopes.automation).toBe(false);
    expect(report.safeToEnableLive).toBe(false);
    expect(report.checks.find((item) => item.key === 'durable_workflow_registration'))
      .toMatchObject({ status: 'block' });
  });

  it('requires an explicit disposition for every review-blocked published row', () => {
    const input = readyInput();
    input.corpus.reviewBlockedWithDisposition = 7;
    const report = evaluateBlogProductionReadinessV4(input, now);
    expect(report.scopes.corpus).toBe(false);
    expect(report.safeToEnableLive).toBe(false);
  });

  it('separates a tested analytics path from naturally zero conversion volume', () => {
    const input = readyInput();
    input.measurement.naturalAttributedEvents30d = 0;
    expect(evaluateBlogProductionReadinessV4(input, now).safeToEnableLive).toBe(true);
    input.measurement.analyticsCanaryPassedAt = null;
    expect(evaluateBlogProductionReadinessV4(input, now).safeToEnableLive).toBe(false);
  });

  it('blocks stale GSC, snapshot drift, incidents, and a frozen rollout', () => {
    const input = readyInput();
    input.measurement.gscLatestMetricDate = '2026-08-01';
    input.delivery.currentSnapshots = 190;
    input.rollout.frozen = true;
    input.rollout.hardIncidentCount = 1;
    const report = evaluateBlogProductionReadinessV4(input, now);
    expect(report.scopes.measurement).toBe(false);
    expect(report.scopes.delivery).toBe(false);
    expect(report.scopes.rollout).toBe(false);
    expect(report.safeToEnableLive).toBe(false);
  });

  it('treats date-only GSC evidence as fresh through the third calendar day', () => {
    const input = readyInput();
    input.measurement.gscLatestMetricDate = '2026-08-30';
    const boundaryNow = new Date('2026-09-02T23:59:59.000Z');
    const fresh = evaluateBlogProductionReadinessV4(input, boundaryNow);
    expect(fresh.checks.find((item) => item.key === 'search_performance_freshness'))
      .toMatchObject({ status: 'pass', evidence: { ageDays: 3 } });

    input.measurement.gscLatestMetricDate = '2026-08-29';
    const stale = evaluateBlogProductionReadinessV4(input, boundaryNow);
    expect(stale.checks.find((item) => item.key === 'search_performance_freshness'))
      .toMatchObject({ status: 'block', evidence: { ageDays: 4 } });

    input.measurement.gscLatestMetricDate = '2026-99-99';
    const invalid = evaluateBlogProductionReadinessV4(input, boundaryNow);
    expect(invalid.checks.find((item) => item.key === 'search_performance_freshness'))
      .toMatchObject({ status: 'block', evidence: { ageDays: null } });
  });
});
