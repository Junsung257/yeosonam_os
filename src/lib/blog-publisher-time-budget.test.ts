import { describe, expect, it } from 'vitest';
import {
  canRunOptionalPublisherWork,
  canStartPublisherItem,
  canStartPublisherItemWithFallback,
  getPublisherExtraClaimRecoveryPlan,
  getPublisherGenerationTimeoutMs,
  getPublisherRemainingMs,
  getUnattemptedClaimReleaseIds,
  sortPublisherQueueForTimeBudget,
} from './blog-publisher-time-budget';

describe('blog publisher time budget', () => {
  it('computes a non-negative remaining budget', () => {
    expect(getPublisherRemainingMs(1_000, 10_000, 4_000)).toBe(7_000);
    expect(getPublisherRemainingMs(1_000, 10_000, 12_000)).toBe(0);
  });

  it('blocks starting a new item when the reserve is too low', () => {
    expect(canStartPublisherItem(90_000, 75_000)).toBe(true);
    expect(canStartPublisherItem(74_999, 75_000)).toBe(false);
  });

  it('allows low-time deterministic fallback starts only for eligible items', () => {
    expect(canStartPublisherItemWithFallback({
      remainingMs: 44_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      fallbackEligible: true,
    })).toBe(true);
    expect(canStartPublisherItemWithFallback({
      remainingMs: 44_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      fallbackEligible: false,
    })).toBe(false);
    expect(canStartPublisherItemWithFallback({
      remainingMs: 29_999,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      fallbackEligible: true,
    })).toBe(false);
  });

  it('caps generation timeout so the handler can still return a summary', () => {
    expect(getPublisherGenerationTimeoutMs(180_000, 120_000, 45_000)).toBe(120_000);
    expect(getPublisherGenerationTimeoutMs(90_000, 120_000, 45_000)).toBe(45_000);
    expect(getPublisherGenerationTimeoutMs(50_000, 120_000, 45_000)).toBe(0);
  });

  it('keeps optional work behind an explicit remaining-time threshold', () => {
    expect(canRunOptionalPublisherWork(60_000, 45_000)).toBe(true);
    expect(canRunOptionalPublisherWork(44_999, 45_000)).toBe(false);
  });

  it('keeps claiming normal candidates while enough time remains', () => {
    expect(getPublisherExtraClaimRecoveryPlan({
      remainingMs: 90_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      remainingQuota: 2,
      maxBatch: 1,
      claimPoolMultiplier: 4,
      maxCandidatePool: 12,
    })).toEqual({
      canClaim: true,
      claimLimit: 8,
      fallbackEligibleOnly: false,
      remainingQuota: 2,
      reason: 'normal_generation_window',
    });
  });

  it('switches extra claims to fallback-eligible information candidates in the low-time recovery window', () => {
    expect(getPublisherExtraClaimRecoveryPlan({
      remainingMs: 44_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      remainingQuota: 4,
      maxBatch: 1,
      claimPoolMultiplier: 4,
      maxCandidatePool: 12,
    })).toEqual({
      canClaim: true,
      claimLimit: 12,
      fallbackEligibleOnly: true,
      remainingQuota: 4,
      reason: 'fallback_only_window',
    });
  });

  it('stops extra claims only when even deterministic fallback cannot safely finish', () => {
    expect(getPublisherExtraClaimRecoveryPlan({
      remainingMs: 29_999,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      remainingQuota: 1,
      maxBatch: 1,
      claimPoolMultiplier: 4,
      maxCandidatePool: 12,
    })).toMatchObject({
      canClaim: false,
      claimLimit: 0,
      fallbackEligibleOnly: false,
      remainingQuota: 1,
      reason: 'insufficient_time',
    });
  });

  it('does not claim extra rows after the daily quota is filled', () => {
    expect(getPublisherExtraClaimRecoveryPlan({
      remainingMs: 90_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      remainingQuota: 0,
      maxBatch: 1,
      claimPoolMultiplier: 4,
      maxCandidatePool: 12,
    })).toMatchObject({
      canClaim: false,
      claimLimit: 0,
      reason: 'quota_filled',
    });
  });

  it('prioritizes deterministic fallback-eligible info candidates when normal generation cannot safely start', () => {
    const queue = [
      { id: 'product', product_id: 'p1' },
      { id: 'card', card_news_id: 'c1' },
      { id: 'info' },
    ];

    expect(sortPublisherQueueForTimeBudget(queue, {
      remainingMs: 44_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      isFallbackEligible: item => !item.product_id && !item.card_news_id,
    }).map(item => item.id)).toEqual(['info', 'product', 'card']);
  });

  it('keeps claimed order while normal generation still has enough time', () => {
    const queue = [
      { id: 'product', product_id: 'p1' },
      { id: 'info' },
    ];

    expect(sortPublisherQueueForTimeBudget(queue, {
      remainingMs: 90_000,
      minItemStartMs: 75_000,
      fallbackMinItemStartMs: 30_000,
      isFallbackEligible: item => !item.product_id,
    }).map(item => item.id)).toEqual(['product', 'info']);
  });

  it('identifies claimed rows that were never attempted so the next run can publish them', () => {
    const claimed = [
      { id: 'attempted' },
      { id: 'not-attempted' },
      { id: 'not-attempted' },
      { id: '  spaced-id  ' },
      { id: null },
    ];

    expect(getUnattemptedClaimReleaseIds(claimed, new Set(['attempted']))).toEqual([
      'not-attempted',
      'spaced-id',
    ]);
  });
});
