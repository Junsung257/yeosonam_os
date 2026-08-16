import { describe, expect, it } from 'vitest';
import {
  BLOG_DAILY_AI_COST_CAP_USD_DEFAULT,
  blogBudgetDayKstV4,
  estimateBlogAiCallReservationUsdV4,
  evaluateBlogAiBudgetReservationV4,
  resolveBlogDailyAiCostCapUsdV4,
} from './blog-ai-budget-v4';

describe('blog AI budget V4', () => {
  it('defaults invalid or absent caps to the fail-safe $2 contract and allows an explicit zero kill switch', () => {
    expect(resolveBlogDailyAiCostCapUsdV4(undefined)).toBe(BLOG_DAILY_AI_COST_CAP_USD_DEFAULT);
    expect(resolveBlogDailyAiCostCapUsdV4('not-money')).toBe(BLOG_DAILY_AI_COST_CAP_USD_DEFAULT);
    expect(resolveBlogDailyAiCostCapUsdV4('0')).toBe(0);
  });

  it('uses a KST accounting day at the UTC boundary', () => {
    expect(blogBudgetDayKstV4(new Date('2026-08-16T14:59:59.000Z'))).toBe('2026-08-16');
    expect(blogBudgetDayKstV4(new Date('2026-08-16T15:00:00.000Z'))).toBe('2026-08-17');
  });

  it('blocks before a call when actual plus reserved plus requested exceeds the cap', () => {
    expect(evaluateBlogAiBudgetReservationV4({ actualUsd: 1.25, reservedUsd: 0.5, capUsd: 2 }, 0.25))
      .toMatchObject({ allowed: true, remainingAfterUsd: 0, reason: 'budget_reserved' });
    expect(evaluateBlogAiBudgetReservationV4({ actualUsd: 1.25, reservedUsd: 0.5, capUsd: 2 }, 0.25000001))
      .toMatchObject({ allowed: false, remainingBeforeUsd: 0.25, reason: 'daily_ai_cost_cap_reached' });
  });

  it('rejects a zero, negative, or non-finite reservation', () => {
    expect(evaluateBlogAiBudgetReservationV4({ actualUsd: 0, reservedUsd: 0, capUsd: 2 }, 0).reason)
      .toBe('invalid_budget_request');
    expect(evaluateBlogAiBudgetReservationV4({ actualUsd: 0, reservedUsd: 0, capUsd: 2 }, Number.NaN).allowed)
      .toBe(false);
  });

  it('reserves every DeepSeek stage at worst-case cache-miss prices', () => {
    const deepseek = estimateBlogAiCallReservationUsdV4({
      stage: 'rewrite_pro_high',
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192,
      now: new Date('2026-08-17T11:00:00.000Z'),
    });
    expect(deepseek).toBeCloseTo((64_000 * 0.66 + 8_192 * 1.98) / 1_000_000, 8);
    const finalRewrite = estimateBlogAiCallReservationUsdV4({
      stage: 'rewrite_pro_max',
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192,
      now: new Date('2026-08-17T11:00:00.000Z'),
    });
    expect(finalRewrite).toBe(deepseek);
  });
});
