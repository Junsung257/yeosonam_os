import type { BlogDataReadinessReportV3 } from './blog-data-readiness-v3';
import type { BlogRuntimeSchemaReadinessV3 } from './blog-runtime-readiness-v3';

export type BlogProductionReadinessStatusV3 = 'pass' | 'warning' | 'block';

export interface BlogProductionReadinessCheckV3 {
  key: string;
  status: BlogProductionReadinessStatusV3;
  evidence: unknown;
  reason: string;
}

export interface BlogPublicSurfaceReadinessV3 {
  key: 'catalog' | 'sitemap' | 'rss' | 'image_sitemap' | 'detail';
  url: string;
  passed: boolean;
  statusCode: number | null;
  reason: string;
}

export interface BlogProductionReadinessInputV3 {
  schema: BlogRuntimeSchemaReadinessV3;
  data: BlogDataReadinessReportV3;
  source: {
    expectedBranch: string;
    productionBranch: string | null;
    productionCommitSha: string | null;
  };
  migrations: {
    expected: string[];
    present: string[];
    latestRemoteVersion: string | null;
  };
  corpus: {
    published: number | null;
    publicEligible: number | null;
    currentSnapshots: number | null;
    reviewBlockedPublished: number | null;
    queuedWithoutDemand: number | null;
  };
  runtime: {
    databaseUnavailableErrors7d: number | null;
  };
  surfaces: BlogPublicSurfaceReadinessV3[];
}

export interface BlogProductionReadinessReportV3 {
  version: 'blog-production-readiness-v3';
  generatedAt: string;
  deliveryReady: boolean;
  measurementReady: boolean;
  corpusReady: boolean;
  safeToEnableLive: boolean;
  checks: BlogProductionReadinessCheckV3[];
}

export function evaluateBlogProductionReadinessV3(
  input: BlogProductionReadinessInputV3,
  generatedAt = new Date(),
): BlogProductionReadinessReportV3 {
  const missingMigrations = input.migrations.expected.filter(
    (version) => !input.migrations.present.includes(version),
  );
  const outOfOrderMigrations = input.migrations.latestRemoteVersion
    ? missingMigrations.filter((version) => version < input.migrations.latestRemoteVersion!)
    : [];
  const snapshotParity = input.corpus.publicEligible != null
    && input.corpus.publicEligible > 0
    && input.corpus.currentSnapshots === input.corpus.publicEligible;
  const allSurfacesPassed = input.surfaces.length === 5
    && input.surfaces.every((surface) => surface.passed);

  const checks: BlogProductionReadinessCheckV3[] = [
    {
      key: 'production_source_branch',
      status: input.source.productionBranch === input.source.expectedBranch
        && Boolean(input.source.productionCommitSha) ? 'pass' : 'block',
      evidence: input.source,
      reason: input.source.productionBranch === input.source.expectedBranch
        && Boolean(input.source.productionCommitSha)
        ? 'immutable production commit is sourced from the allowed branch'
        : 'production branch or immutable commit evidence is missing',
    },
    {
      key: 'required_migrations',
      status: missingMigrations.length === 0 ? 'pass' : 'block',
      evidence: { missingMigrations, outOfOrderMigrations },
      reason: missingMigrations.length === 0
        ? 'all Blog Quality Engine V3 migrations are recorded remotely'
        : 'one or more required V3 migrations are absent',
    },
    {
      key: 'runtime_schema',
      status: input.schema.publishReady && input.schema.deliveryReady ? 'pass' : 'block',
      evidence: { missing: input.schema.missing },
      reason: input.schema.publishReady && input.schema.deliveryReady
        ? 'publication and delivery resources are queryable'
        : 'publication or durable delivery resources are unavailable',
    },
    {
      key: 'snapshot_parity',
      status: snapshotParity ? 'pass' : 'block',
      evidence: {
        publicEligible: input.corpus.publicEligible,
        currentSnapshots: input.corpus.currentSnapshots,
      },
      reason: snapshotParity
        ? 'every currently eligible article has one current durable snapshot'
        : 'eligible article and current snapshot counts differ or are unavailable',
    },
    {
      key: 'public_surfaces',
      status: allSurfacesPassed ? 'pass' : 'block',
      evidence: input.surfaces,
      reason: allSurfacesPassed
        ? 'catalog, detail, sitemap, RSS, and image sitemap passed'
        : 'one or more public surfaces are degraded or unverified',
    },
    {
      key: 'runtime_database_reliability',
      status: input.runtime.databaseUnavailableErrors7d === 0 ? 'pass' : 'block',
      evidence: input.runtime.databaseUnavailableErrors7d,
      reason: input.runtime.databaseUnavailableErrors7d === 0
        ? 'no BLOG_DATABASE_UNAVAILABLE runtime errors were observed in the last 7 days'
        : input.runtime.databaseUnavailableErrors7d == null
          ? '7-day production runtime error evidence was not supplied'
          : 'BLOG_DATABASE_UNAVAILABLE errors remain in the 7-day production window',
    },
    {
      key: 'measurement_pipeline',
      status: input.schema.measurementReady && input.data.status !== 'critical'
        ? input.data.status === 'warning' ? 'warning' : 'pass'
        : 'block',
      evidence: input.data,
      reason: input.schema.measurementReady && input.data.status !== 'critical'
        ? 'measurement resources contain usable recent evidence'
        : 'measurement schema or recent observations are incomplete',
    },
    {
      key: 'review_blocked_published_rows',
      status: input.corpus.reviewBlockedPublished === 0 ? 'pass' : 'block',
      evidence: input.corpus.reviewBlockedPublished,
      reason: input.corpus.reviewBlockedPublished === 0
        ? 'no published row is blocked by editorial review'
        : 'published review-blocked rows still require an approved disposition',
    },
    {
      key: 'queued_demand_evidence',
      status: input.corpus.queuedWithoutDemand === 0 ? 'pass' : 'block',
      evidence: input.corpus.queuedWithoutDemand,
      reason: input.corpus.queuedWithoutDemand === 0
        ? 'every queued topic has a verified demand signal'
        : 'one or more queued topics have no verified demand signal',
    },
  ];

  const deliveryKeys = new Set([
    'production_source_branch',
    'required_migrations',
    'runtime_schema',
    'snapshot_parity',
    'public_surfaces',
    'runtime_database_reliability',
  ]);
  const corpusKeys = new Set(['review_blocked_published_rows', 'queued_demand_evidence']);
  const deliveryReady = checks
    .filter((check) => deliveryKeys.has(check.key))
    .every((check) => check.status !== 'block');
  const measurementReady = checks.find((check) => check.key === 'measurement_pipeline')?.status !== 'block';
  const corpusReady = checks
    .filter((check) => corpusKeys.has(check.key))
    .every((check) => check.status !== 'block');

  return {
    version: 'blog-production-readiness-v3',
    generatedAt: generatedAt.toISOString(),
    deliveryReady,
    measurementReady,
    corpusReady,
    safeToEnableLive: deliveryReady && measurementReady && corpusReady,
    checks,
  };
}
