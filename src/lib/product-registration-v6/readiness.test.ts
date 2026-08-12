import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV6ReadinessReport } from './readiness';

const database = {
  v6ColumnAvailable: true,
  authorityMode: 'kernel' as const,
  publicationFrozen: false,
  schemaVersion: 'product-registration-authority-hardened-1',
  schemaVerificationState: 'verified',
  unvalidatedTenantForeignKeys: 0,
  legacyPublicationRpcsExecutable: false,
  publishedPointerCount: 1,
  passedProofCount: 2,
  unfinishedJobCount: 0,
  staleUnfinishedJobCount: 0,
  uniqueSourceCount: 40,
  terminalOutcomeCount: 40,
  legacyInventoryCount: 990,
  legacyBackfillTotalCount: 990,
  legacyBackfillTerminalCount: 990,
  legacyBackfillFailedCount: 0,
  mediaReadyRevisionCount: 20,
  benchmarkPassedCount: 1,
  benchmarkExactMatchRate: 0.995,
  benchmarkCriticalFalsePublishCount: 0,
  cohortSampleCount: 30,
  cohortCriticalDefectCount: 0,
  eligibleCohortCount: 1,
};

describe('product registration V6 readiness', () => {
  it('blocks canary when workflow or browser proof is unavailable', () => {
    const report = buildProductRegistrationV6ReadinessReport({
      config: { authorityMode: 'legacy', workflowEnabled: false, shadowEnabled: true, publishEnabled: false, publicationFrozen: true },
      credentials: {
        proofSecret: true,
        browser: false,
        oag: false,
        cirium: false,
        clova: false,
        googleDocumentAi: false,
        ocrEnabled: false,
        mediaProvider: false,
      },
      database: { ...database, authorityMode: 'legacy', publicationFrozen: true },
    });

    expect(report.readyForCanary).toBe(false);
    expect(report.readyForPublication).toBe(false);
    expect(report.checks.map(check => check.code)).toContain('V6_BROWSER_PROOF_RUNTIME_MISSING');
  });

  it('allows a restricted canary while keeping full cohort publication limited', () => {
    const report = buildProductRegistrationV6ReadinessReport({
      config: { authorityMode: 'kernel', workflowEnabled: true, shadowEnabled: true, publishEnabled: true, publicationFrozen: false },
      credentials: {
        proofSecret: true,
        browser: true,
        oag: false,
        cirium: false,
        clova: false,
        googleDocumentAi: false,
        ocrEnabled: false,
        mediaProvider: true,
      },
      database,
    });

    expect(report.readyForCanary).toBe(true);
    expect(report.readyForPublication).toBe(true);
    expect(report.readyForFullCohort).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      code: 'V6_TRANSPORT_PROVIDERS_INCOMPLETE',
      status: 'warning',
    }));
  });

  it('blocks canary while a stale job or corpus defect remains', () => {
    const report = buildProductRegistrationV6ReadinessReport({
      config: { authorityMode: 'kernel', workflowEnabled: true, shadowEnabled: true, publishEnabled: false, publicationFrozen: true },
      credentials: {
        proofSecret: true,
        browser: true,
        oag: true,
        cirium: true,
        clova: false,
        googleDocumentAi: false,
        ocrEnabled: false,
        mediaProvider: true,
      },
      database: {
        ...database,
        publicationFrozen: true,
        staleUnfinishedJobCount: 1,
        benchmarkCriticalFalsePublishCount: 1,
      },
    });

    expect(report.readyForCanary).toBe(false);
    expect(report.checks.map(check => check.code)).toEqual(expect.arrayContaining([
      'V6_STALE_JOBS_PRESENT',
      'V6_CORPUS_BENCHMARK_NOT_PASSED',
    ]));
  });
});
