import { describe, expect, it } from 'vitest';

import {
  evaluateBlogDeploymentProvenanceV3,
  evaluateBlogAutopublishDecisionV3,
  hasVerifiedBlogDemandSignal,
  readBlogAutopublishPolicyV3,
} from './blog-autopublish-policy-v3';

describe('blog autopublish policy v3', () => {
  it('fails closed to draft_only with conservative defaults', () => {
    expect(readBlogAutopublishPolicyV3({})).toMatchObject({
      requestedMode: 'draft_only',
      mode: 'draft_only',
      dailyPublishCap: 5,
      publicationRampStage: 'pilot_3',
      autoRampEnabled: false,
      autoRollbackEnabled: true,
      maxWeatherShare30d: 0.2,
      maxSameArchetypeInLast10: 2,
      requireDemandSignal: true,
      deploymentProvenance: {
        required: false,
        passed: true,
        expectedGitRef: 'main',
      },
    });
    expect(readBlogAutopublishPolicyV3({ BLOG_AUTOPUBLISH_MODE: 'oops' }).mode).toBe('draft_only');
  });

  it('forces production feature-branch deployments to draft_only', () => {
    const policy = readBlogAutopublishPolicyV3({
      BLOG_AUTOPUBLISH_MODE: 'live',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'codex/unsafe-feature',
      VERCEL_GIT_COMMIT_SHA: 'abc123',
    });

    expect(policy.requestedMode).toBe('live');
    expect(policy.mode).toBe('draft_only');
    expect(policy.deploymentProvenance).toMatchObject({
      required: true,
      passed: false,
      expectedGitRef: 'main',
      actualGitRef: 'codex/unsafe-feature',
      reasons: ['production_git_ref_not_allowed'],
    });
  });

  it('requires production system git evidence before autopublishing', () => {
    const provenance = evaluateBlogDeploymentProvenanceV3({ VERCEL_ENV: 'production' });

    expect(provenance.passed).toBe(false);
    expect(provenance.reasons).toEqual([
      'production_git_ref_missing',
      'production_commit_sha_missing',
    ]);
  });

  it('never publishes in draft_only and never runs public side effects', () => {
    const decision = evaluateBlogAutopublishDecisionV3(readBlogAutopublishPolicyV3({}), {
      allGatesPassed: true,
      reviewStatus: 'approved',
      demand: { customerQuestionCount: 3 },
    });
    expect(decision).toMatchObject({
      publish: false,
      contentStatus: 'draft',
      queueStatus: 'pending_review',
      runPublicSideEffects: false,
    });
  });

  it('publishes only approved work in reviewed_only', () => {
    const policy = readBlogAutopublishPolicyV3({ BLOG_AUTOPUBLISH_MODE: 'reviewed_only' });
    const base = { allGatesPassed: true, demand: { editorApprovedSeed: true } };
    expect(evaluateBlogAutopublishDecisionV3(policy, { ...base, reviewStatus: 'pending_review' }).publish).toBe(false);
    expect(evaluateBlogAutopublishDecisionV3(policy, { ...base, reviewStatus: 'approved' }).publish).toBe(true);
  });

  it('blocks fallback, missing demand, high-risk without approval, and portfolio saturation', () => {
    const policy = readBlogAutopublishPolicyV3({ BLOG_AUTOPUBLISH_MODE: 'live' });
    const decision = evaluateBlogAutopublishDecisionV3(policy, {
      allGatesPassed: true,
      deterministicFallback: true,
      riskLevel: 'HIGH',
      reviewStatus: 'none',
      demand: null,
      publishedToday: 5,
      weatherShare30d: 0.5,
      isWeatherContent: true,
      sameArchetypeInLast10: 2,
    });
    expect(decision.publish).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'deterministic_fallback_not_publishable',
      'verified_demand_signal_missing',
      'human_approval_required',
      'daily_publish_cap_reached',
      'weather_share_cap_exceeded',
      'archetype_saturation_cap_reached',
    ]));
  });

  it('allows non-weather work to dilute an over-saturated weather portfolio', () => {
    const policy = readBlogAutopublishPolicyV3({ BLOG_AUTOPUBLISH_MODE: 'live' });
    const decision = evaluateBlogAutopublishDecisionV3(policy, {
      allGatesPassed: true,
      demand: { customerQuestionCount: 1 },
      weatherShare30d: 0.95,
      isWeatherContent: false,
    });

    expect(decision.reasons).not.toContain('weather_share_cap_exceeded');
    expect(decision.publish).toBe(true);
  });

  it('does not invent demand when volume and trend are null', () => {
    expect(hasVerifiedBlogDemandSignal({ monthlySearchVolume: null, trendScore: null })).toBe(false);
    expect(hasVerifiedBlogDemandSignal({ gsc: true })).toBe(true);
  });

  it('ignores the retired environment volume target and never exceeds five per day', () => {
    expect(readBlogAutopublishPolicyV3({
      BLOG_AUTOPUBLISH_MODE: 'live', BLOG_DAILY_PUBLISH_CAP: '30',
    })).toMatchObject({ requestedDailyPublishCap: 5, dailyPublishCap: 5, publicationRampStage: 'pilot_3' });
    expect(readBlogAutopublishPolicyV3({
      BLOG_AUTOPUBLISH_MODE: 'live', BLOG_DAILY_PUBLISH_CAP: '30', BLOG_PUBLICATION_RAMP_STAGE: 'ramp_10',
    })).toMatchObject({ requestedDailyPublishCap: 5, dailyPublishCap: 5, publicationRampStage: 'ramp_10' });
    expect(readBlogAutopublishPolicyV3({
      BLOG_AUTOPUBLISH_MODE: 'live', BLOG_DAILY_PUBLISH_CAP: '99', BLOG_PUBLICATION_RAMP_STAGE: 'max_30',
      BLOG_AUTO_RAMP_ENABLED: 'true', BLOG_AUTO_ROLLBACK_ENABLED: 'false',
    })).toMatchObject({
      requestedDailyPublishCap: 5,
      dailyPublishCap: 5,
      publicationRampStage: 'max_30',
      autoRampEnabled: true,
      autoRollbackEnabled: false,
    });
  });

  it('keeps retired stages as metadata without changing the DB volume ceiling', () => {
    expect(readBlogAutopublishPolicyV3({ BLOG_PUBLICATION_RAMP_STAGE: 'max_20' }))
      .toMatchObject({ publicationRampStage: 'pilot_3', dailyPublishCap: 5 });
    expect(readBlogAutopublishPolicyV3({ BLOG_PUBLICATION_RAMP_STAGE: 'ramp_5' }))
      .toMatchObject({ publicationRampStage: 'pilot_3', dailyPublishCap: 5 });
  });
});
