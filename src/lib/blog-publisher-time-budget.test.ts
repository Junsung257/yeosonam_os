import { describe, expect, it } from 'vitest';
import {
  canRunOptionalPublisherWork,
  canStartPublisherItem,
  getPublisherGenerationTimeoutMs,
  getPublisherRemainingMs,
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

  it('caps generation timeout so the handler can still return a summary', () => {
    expect(getPublisherGenerationTimeoutMs(180_000, 120_000, 45_000)).toBe(120_000);
    expect(getPublisherGenerationTimeoutMs(90_000, 120_000, 45_000)).toBe(45_000);
    expect(getPublisherGenerationTimeoutMs(50_000, 120_000, 45_000)).toBe(0);
  });

  it('keeps optional work behind an explicit remaining-time threshold', () => {
    expect(canRunOptionalPublisherWork(60_000, 45_000)).toBe(true);
    expect(canRunOptionalPublisherWork(44_999, 45_000)).toBe(false);
  });
});
