import { describe, expect, it } from 'vitest';
import {
  BLOG_FINAL_QUALITY_MINIMUM_SCORE_V1,
  buildBlogFinalQualityDecisionV1,
  buildBlogOperationStateV1,
  hashBlogContentRevisionV1,
} from './blog-quality-decision-v1';

describe('Blog V4 final quality decision v1', () => {
  it('fails closed when a hard quality blocker remains despite a high score', () => {
    const decision = buildBlogFinalQualityDecisionV1({
      revisionId: 'revision-1',
      evaluatedContentHash: 'a'.repeat(64),
      comparisonCorpusVersion: 'corpus-1',
      qualityEvaluation: {
        passed: false,
        score: 96.04,
        failureReasons: [{ code: 'opening_too_similar' }],
      },
    });

    expect(decision.overallScore).toBe(96.04);
    expect(decision.minimumScore).toBe(BLOG_FINAL_QUALITY_MINIMUM_SCORE_V1);
    expect(decision.passed).toBe(false);
    expect(decision.decision).toBe('repairable_fail');
    expect(decision.hardBlockers).toContain('opening_too_similar');
  });

  it('uses the final decision as the only publish-quality score', () => {
    const decision = buildBlogFinalQualityDecisionV1({
      revisionId: 'revision-2',
      evaluatedContentHash: 'b'.repeat(64),
      comparisonCorpusVersion: 'corpus-1',
      qualityEvaluation: { passed: true, score: 98 },
      publishQuality: { passed: true, score: 97 },
      claimValidationPassed: true,
      preflightPassed: true,
    });

    expect(decision.passed).toBe(true);
    expect(decision.decision).toBe('pass');
    expect(decision.overallScore).toBe(97);
    expect(decision.hardBlockers).toEqual([]);
  });

  it('separates draft-only suppression from quality failure', () => {
    const decision = buildBlogFinalQualityDecisionV1({
      revisionId: 'revision-3',
      evaluatedContentHash: 'c'.repeat(64),
      comparisonCorpusVersion: 'corpus-1',
      qualityEvaluation: { passed: true, score: 95 },
      publishQuality: { passed: true, score: 95 },
      claimValidationPassed: true,
      preflightPassed: true,
    });
    const state = buildBlogOperationStateV1({
      generationSucceeded: true,
      finalQualityDecision: decision,
      reviewRequired: true,
      publicationSuppressed: true,
    });

    expect(state.generationStatus).toBe('succeeded');
    expect(state.reviewStatus).toBe('pending');
    expect(state.publicationStatus).toBe('suppressed_by_policy');
    expect(state.indexingStatus).toBe('not_attempted');
  });

  it('marks a quality-passed generation-only operation completed without publication', () => {
    const decision = buildBlogFinalQualityDecisionV1({
      revisionId: 'revision-4',
      evaluatedContentHash: 'd'.repeat(64),
      comparisonCorpusVersion: 'corpus-1',
      qualityEvaluation: { passed: true, score: 96 },
      publishQuality: { passed: true, score: 95 },
      claimValidationPassed: true,
      preflightPassed: true,
    });
    const state = buildBlogOperationStateV1({
      generationSucceeded: true,
      finalQualityDecision: decision,
      finalQualityDecisionId: 'decision-4',
      reviewRequired: false,
      publicationSuppressed: true,
    });

    expect(state.reviewStatus).toBe('not_required');
    expect(state.publicationStatus).toBe('suppressed_by_policy');
    expect(state.finalRevisionId).toBe('revision-4');
    expect(state.finalQualityDecisionId).toBe('decision-4');
  });

  it('hashes the exact publication inputs', () => {
    expect(hashBlogContentRevisionV1({
      blogHtml: 'body',
      title: 'title',
      description: 'description',
      slug: 'slug',
    })).toHaveLength(64);
  });
});
