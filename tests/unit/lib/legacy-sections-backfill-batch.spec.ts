import { describe, expect, it } from 'vitest';
import { classifyLegacyBackfillNeed } from '@/lib/legacy-sections-backfill-batch';

describe('classifyLegacyBackfillNeed', () => {
  it('A1: price_dates 비어 있으면 a1', () => {
    expect(classifyLegacyBackfillNeed({ price_dates: [], excludes: ['a'] })).toBe('a1-price-dates-empty');
  });

  it('A2: excludes 콤마-split 시 A2 우선', () => {
    const excludes = Array.from({ length: 25 }, (_, i) => `item${i}`);
    expect(classifyLegacyBackfillNeed({ price_dates: [], excludes })).toBe('a2-excludes-broken');
  });

  it('정상 패키지는 null', () => {
    expect(classifyLegacyBackfillNeed({
      price_dates: [{ date: '2026-06-01', price: 100 }],
      excludes: ['항공 미포함'],
    })).toBeNull();
  });
});
