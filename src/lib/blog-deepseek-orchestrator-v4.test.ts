import { describe, expect, it } from 'vitest';
import {
  BLOG_DEEPSEEK_MODELS,
  calculateDeepSeekCostV4,
  decideBlogQualityRouteV4,
  isBlogGenerationWindowKstV4,
  isDeepSeekOffPeakAt,
  isDeepSeekPeakAt,
  nextBlogPublicationSlotKstV4,
  resolveBlogPublicationRampCapV4,
  resolveDeepSeekPriceV4,
} from './blog-deepseek-orchestrator-v4';

describe('blog DeepSeek orchestrator V4', () => {
  it('publishes only a blocker-free score of 90 or more', () => {
    expect(decideBlogQualityRouteV4({ score: 90, completedAttempts: 1 })).toMatchObject({
      route: 'approved_for_slot', publishable: true,
    });
    expect(decideBlogQualityRouteV4({
      score: 96, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'rewrite_pro_high', publishable: false });
  });

  it('re-researches missing evidence but rewrites removable unsupported prose', () => {
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['missing_evidence'],
    })).toMatchObject({ route: 'reresearch', nextStage: null });
    expect(decideBlogQualityRouteV4({
      score: 71, completedAttempts: 1, hardBlockers: ['unsupported_number'],
    })).toMatchObject({ route: 'rewrite_pro_max', nextStage: 'rewrite_pro_max' });
  });

  it('routes 75-89 to Pro high and lower soft scores to Pro max', () => {
    expect(decideBlogQualityRouteV4({ score: 89.99, completedAttempts: 1 }).nextStage).toBe('rewrite_pro_high');
    expect(decideBlogQualityRouteV4({ score: 74.99, completedAttempts: 1 }).nextStage).toBe('rewrite_pro_max');
  });

  it('quarantines non-converging or third-attempt candidates', () => {
    expect(decideBlogQualityRouteV4({ score: 79, previousScore: 76, completedAttempts: 2 }).route).toBe('quarantine');
    expect(decideBlogQualityRouteV4({ score: 89, completedAttempts: 3 }).route).toBe('quarantine');
  });

  it('never auto-publishes HIGH risk without human approval', () => {
    expect(decideBlogQualityRouteV4({ score: 100, completedAttempts: 1, riskLevel: 'HIGH' })).toMatchObject({
      route: 'human_review', publishable: false,
    });
  });

  it('uses the official post-transition UTC peak windows', () => {
    expect(isDeepSeekPeakAt(new Date('2026-08-17T01:00:00.000Z'))).toBe(true);
    expect(isDeepSeekPeakAt(new Date('2026-08-17T04:00:00.000Z'))).toBe(false);
    expect(isDeepSeekPeakAt(new Date('2026-08-17T06:00:00.000Z'))).toBe(true);
    expect(isDeepSeekOffPeakAt(new Date('2026-08-17T10:00:00.000Z'))).toBe(true);
  });

  it('prices cache hit, miss and output tokens separately without a cheap unknown fallback', () => {
    expect(calculateDeepSeekCostV4(BLOG_DEEPSEEK_MODELS.draft, {
      inputTokens: 1_000_000, cacheHitInputTokens: 250_000, outputTokens: 100_000,
    }, new Date('2026-08-17T11:00:00.000Z')).estimatedCostUsd).toBe(0.23275);
    expect(() => resolveDeepSeekPriceV4('deepseek-unknown')).toThrow(/unsupported/);
  });

  it('recognizes the overnight KST compute window and clamps publication ramp stages', () => {
    expect(isBlogGenerationWindowKstV4(new Date('2026-08-16T16:00:00.000Z'))).toBe(true);
    expect(isBlogGenerationWindowKstV4(new Date('2026-08-16T22:00:00.000Z'))).toBe(false);
    expect(resolveBlogPublicationRampCapV4('max_20').cap).toBe(20);
    expect(resolveBlogPublicationRampCapV4('invalid').cap).toBe(3);
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-16T17:00:00.000Z')))
      .toBe('2026-08-17T00:00:00.000Z');
    expect(nextBlogPublicationSlotKstV4(new Date('2026-08-17T13:00:00.000Z')))
      .toBe('2026-08-18T00:00:00.000Z');
  });
});
