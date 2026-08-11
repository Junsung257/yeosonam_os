import { describe, expect, it } from 'vitest';

import {
  evaluateBlogAutopublishDecisionV3,
  hasVerifiedBlogDemandSignal,
  readBlogAutopublishPolicyV3,
} from './blog-autopublish-policy-v3';

describe('blog autopublish policy v3', () => {
  it('fails closed to draft_only with conservative defaults', () => {
    expect(readBlogAutopublishPolicyV3({})).toEqual({
      mode: 'draft_only',
      dailyPublishCap: 1,
      maxWeatherShare30d: 0.2,
      maxSameArchetypeInLast10: 2,
      requireDemandSignal: true,
    });
    expect(readBlogAutopublishPolicyV3({ BLOG_AUTOPUBLISH_MODE: 'oops' }).mode).toBe('draft_only');
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
      publishedToday: 1,
      weatherShare30d: 0.5,
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

  it('does not invent demand when volume and trend are null', () => {
    expect(hasVerifiedBlogDemandSignal({ monthlySearchVolume: null, trendScore: null })).toBe(false);
    expect(hasVerifiedBlogDemandSignal({ gsc: true })).toBe(true);
  });
});
