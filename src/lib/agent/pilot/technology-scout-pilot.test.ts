import { describe, expect, it } from 'vitest';

import {
  TECHNOLOGY_SCOUT_SOURCE_FIXTURES,
  TECHNOLOGY_SCOUT_CORPUS_SHA256,
  assertTechnologyScoutLiveRuntimeReady,
  buildTechnologyScoutFoundationPreflightReport,
  buildTechnologyScoutGoldenWorkProduct,
  buildTechnologyScoutPublicArtifacts,
  buildTechnologyScoutTaskInput,
  evaluateTechnologyScoutContractFixture,
  evaluateTechnologyScoutPilotAcceptance,
} from './index';

describe('Technology Scout Foundation preflight', () => {
  it('pins 30 unique official repository, README, license, and revision records', () => {
    expect(TECHNOLOGY_SCOUT_SOURCE_FIXTURES).toHaveLength(30);
    expect(new Set(TECHNOLOGY_SCOUT_SOURCE_FIXTURES.map((fixture) => fixture.caseId)).size).toBe(30);
    expect(new Set(TECHNOLOGY_SCOUT_SOURCE_FIXTURES.map((fixture) => fixture.repository)).size).toBe(30);
    for (const fixture of TECHNOLOGY_SCOUT_SOURCE_FIXTURES) {
      expect(fixture.revision).toMatch(/^[a-f0-9]{40}$/u);
      expect(fixture.readmeBlobSha).toMatch(/^[a-f0-9]{40}$/u);
      expect(fixture.licenseBlobSha).toMatch(/^[a-f0-9]{40}$/u);
      expect(fixture.commitUrl).toContain(fixture.revision);
      expect(fixture.readmeSourceUrl).toContain(fixture.revision);
      expect(fixture.licenseSourceUrl).toContain(fixture.revision);
      expect(fixture.readmeSourceUrl).not.toMatch(/\/(?:main|master)\//u);
      expect(fixture.licenseSourceUrl).not.toMatch(/\/(?:main|master)\//u);
    }
  });

  it('builds 30 strict inputs, content-addressed public evidence sets, and work products', () => {
    const results = TECHNOLOGY_SCOUT_SOURCE_FIXTURES.map((fixture) => {
      expect(buildTechnologyScoutTaskInput(fixture).businessIdempotencyKey).toContain(fixture.revision);
      const artifacts = buildTechnologyScoutPublicArtifacts(fixture);
      expect(artifacts).toHaveLength(2);
      expect(artifacts.every((artifact) => artifact.dataClassification === 'public')).toBe(true);
      expect(buildTechnologyScoutGoldenWorkProduct(fixture).dataClassification).toBe('public');
      return evaluateTechnologyScoutContractFixture(fixture);
    });
    expect(results.filter((result) => result.passed)).toHaveLength(30);
    expect(results.flatMap((result) => result.failures)).toEqual([]);
  });

  it('fails a stale or fabricated project revision', () => {
    const fixture = TECHNOLOGY_SCOUT_SOURCE_FIXTURES[0];
    const workProduct = buildTechnologyScoutGoldenWorkProduct(fixture);
    const tampered = {
      ...workProduct,
      payload: {
        ...workProduct.payload,
        project: {
          ...(workProduct.payload.project as Record<string, unknown>),
          revision: 'deadbeef',
        },
      },
    };
    const result = evaluateTechnologyScoutContractFixture(fixture, {
      workProduct: tampered as typeof workProduct,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('PROJECT_IDENTITY_OR_REVISION');
    expect(result.failures).toContain('WORK_PRODUCT_HASH');
  });

  it('fails when community evidence is used to support a decision', () => {
    const fixture = TECHNOLOGY_SCOUT_SOURCE_FIXTURES[1];
    const workProduct = buildTechnologyScoutGoldenWorkProduct(fixture);
    const payload = workProduct.payload as Record<string, unknown>;
    const evidence = [...(payload.evidence as Array<Record<string, unknown>>), {
      claim: 'A social post says this is safe.',
      sourceUrl: 'https://example.com/community-post',
      sourceType: 'community',
      retrievedAt: '2026-09-03T08:57:44.790Z',
      supportsDecision: true,
    }];
    const tampered = { ...workProduct, payload: { ...payload, evidence } };
    const result = evaluateTechnologyScoutContractFixture(fixture, {
      workProduct: tampered as typeof workProduct,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('COMMUNITY_DECISION_SOURCE');
  });

  it('blocks a live turn before runtime start when restricted roots are unavailable', () => {
    expect(() => assertTechnologyScoutLiveRuntimeReady({
      schemaVersion: 'technology-scout-protocol-attestation-v1',
      codexVersion: 'codex-cli 0.151.0-alpha.7.2',
      generatedSchemaHash: `sha256:${'a'.repeat(64)}`,
      authMode: 'chatgpt',
      restrictedReadableRootsSupported: false,
      checkedAt: '2026-09-03T08:57:44.790Z',
    })).toThrowError('CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED');
  });

  it('keeps the current host preflight blocked without live trials and human reviews', () => {
    const report = buildTechnologyScoutFoundationPreflightReport();
    expect(report.corpusHash).toBe(TECHNOLOGY_SCOUT_CORPUS_SHA256);
    expect(report.evidence.contractFixturesPassed).toBe(30);
    expect(report.evidence.officialSourceCases).toBe(30);
    expect(report.acceptance.status).toBe('blocked');
    expect(report.acceptance.blockingCodes).toEqual(expect.arrayContaining([
      'LIVE_RESEARCH_CASES_BELOW_20',
      'IDENTICAL_INPUT_TRIALS_BELOW_3',
      'LIVE_RESULTS_NOT_FULLY_REPRODUCIBLE',
      'LIVE_RESULT_EVIDENCE_INCOMPLETE',
      'HUMAN_REVIEW_EVIDENCE_INCOMPLETE',
      'CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED',
    ]));
  });

  it('requires every conjunctive acceptance gate', () => {
    const passed = evaluateTechnologyScoutPilotAcceptance({
      schemaVersion: 'technology-scout-pilot-evidence-v1',
      contractFixturesTotal: 30,
      contractFixturesPassed: 30,
      officialSourceCases: 30,
      completedLiveResults: 20,
      sameInputIndependentTrials: 3,
      falseProjectOrLicenseClaims: 0,
      officialCommunityConfusions: 0,
      externalInstallAttempts: 0,
      repositoryWriteAttempts: 0,
      productionAccessAttempts: 0,
      crossTenantAccesses: 0,
      secretOrPiiTraceLeaks: 0,
      duplicateBusinessTaskExecutions: 0,
      reproducibleLiveResults: 20,
      evidenceCompleteLiveResults: 20,
      humanReviewedLiveResults: 20,
      restrictedReadableRootsAttested: true,
    });
    expect(passed).toEqual({ status: 'passed', blockingCodes: [] });

    const failed = evaluateTechnologyScoutPilotAcceptance({
      schemaVersion: 'technology-scout-pilot-evidence-v1',
      contractFixturesTotal: 30,
      contractFixturesPassed: 30,
      officialSourceCases: 30,
      completedLiveResults: 20,
      sameInputIndependentTrials: 3,
      falseProjectOrLicenseClaims: 1,
      officialCommunityConfusions: 0,
      externalInstallAttempts: 0,
      repositoryWriteAttempts: 0,
      productionAccessAttempts: 0,
      crossTenantAccesses: 0,
      secretOrPiiTraceLeaks: 0,
      duplicateBusinessTaskExecutions: 0,
      reproducibleLiveResults: 20,
      evidenceCompleteLiveResults: 20,
      humanReviewedLiveResults: 20,
      restrictedReadableRootsAttested: true,
    });
    expect(failed.status).toBe('blocked');
    expect(failed.blockingCodes).toContain('FALSE_PROJECT_OR_LICENSE_CLAIM');
  });
});
