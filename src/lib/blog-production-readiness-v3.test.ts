import { describe, expect, it } from 'vitest';
import { evaluateBlogProductionReadinessV3, type BlogProductionReadinessInputV3 } from './blog-production-readiness-v3';

const readyInput = (): BlogProductionReadinessInputV3 => ({
  schema: {
    version: 'blog-runtime-schema-v3',
    checkedAt: '2026-08-12T00:00:00.000Z',
    publishReady: true,
    deliveryReady: true,
    measurementReady: true,
    fullyReady: true,
    missing: [],
    checks: [],
  },
  data: { status: 'ok', checks: [], generatedAt: '2026-08-12T00:00:00.000Z' },
  source: { expectedBranch: 'main', productionBranch: 'main', productionCommitSha: 'abc123' },
  migrations: { expected: ['1', '2'], present: ['1', '2'], latestRemoteVersion: '2' },
  corpus: {
    published: 192,
    publicEligible: 192,
    currentSnapshots: 192,
    reviewBlockedPublished: 0,
    queuedWithoutDemand: 0,
  },
  runtime: { databaseUnavailableErrors7d: 0 },
  surfaces: (['catalog', 'sitemap', 'rss', 'image_sitemap', 'detail'] as const).map((key) => ({
    key,
    url: `https://www.yeosonam.com/${key}`,
    passed: true,
    statusCode: 200,
    reason: 'passed',
  })),
});

describe('blog production readiness v3', () => {
  it('requires the entire delivery, measurement, and corpus story before live mode', () => {
    const report = evaluateBlogProductionReadinessV3(readyInput());
    expect(report).toMatchObject({
      deliveryReady: true,
      measurementReady: true,
      corpusReady: true,
      safeToEnableLive: true,
    });
  });

  it('blocks out-of-order missing migrations and snapshot count drift', () => {
    const input = readyInput();
    input.migrations = { expected: ['1', '2'], present: ['1'], latestRemoteVersion: '9' };
    input.corpus.currentSnapshots = 191;
    const report = evaluateBlogProductionReadinessV3(input);

    expect(report.deliveryReady).toBe(false);
    expect(report.safeToEnableLive).toBe(false);
    expect(report.checks.find((check) => check.key === 'required_migrations')).toMatchObject({
      status: 'block',
      evidence: { missingMigrations: ['2'], outOfOrderMigrations: ['2'] },
    });
    expect(report.checks.find((check) => check.key === 'snapshot_parity')?.status).toBe('block');
  });

  it('keeps delivery and live-publishing readiness separate', () => {
    const input = readyInput();
    input.data = { status: 'critical', checks: [], generatedAt: '2026-08-12T00:00:00.000Z' };
    input.corpus.reviewBlockedPublished = 8;
    input.corpus.queuedWithoutDemand = 8;
    const report = evaluateBlogProductionReadinessV3(input);

    expect(report.deliveryReady).toBe(true);
    expect(report.measurementReady).toBe(false);
    expect(report.corpusReady).toBe(false);
    expect(report.safeToEnableLive).toBe(false);
  });
});
