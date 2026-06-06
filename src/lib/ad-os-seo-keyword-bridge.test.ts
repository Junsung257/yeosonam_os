import { describe, expect, it } from 'vitest';
import {
  buildPaidKeywordCandidatesFromOrganic,
  classifyPaidKeywordIntent,
  normalizePaidKeyword,
  suggestPaidBidKrw,
} from './ad-os-seo-keyword-bridge';

describe('ad-os seo keyword bridge', () => {
  it('normalizes noisy organic queries', () => {
    expect(normalizePaidKeyword('  다낭  가족 패키지 2026!! ')).toBe('다낭 가족 패키지 2026');
  });

  it('classifies paid-search negative intent', () => {
    expect(classifyPaidKeywordIntent('다낭 항공권만 무료')).toBe('negative');
  });

  it('keeps commercial longtail as paid keyword draft candidate', () => {
    const candidates = buildPaidKeywordCandidatesFromOrganic([
      {
        keyword: '다낭 부모님 효도 패키지 가격',
        slug: 'danang-filial-package-price',
        destination: '다낭',
        productId: 'pkg-1',
        impressions: 120,
        clicks: 8,
        avgPosition: 9.5,
        conversions: 1,
        revenueKrw: 1_200_000,
      },
    ], { platform: 'naver', maxCpcGuardKrw: 900 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].intent).toBe('commercial');
    expect(candidates[0].tier).toBe('longtail');
    expect(candidates[0].suggestedBidKrw).toBeLessThanOrEqual(900);
  });

  it('creates zero-bid negative candidate from waste query', () => {
    const [candidate] = buildPaidKeywordCandidatesFromOrganic([
      {
        keyword: '오사카 호텔만 예약 취소',
        slug: 'osaka-hotel-cancel',
        destination: '오사카',
        productId: 'pkg-2',
        impressions: 80,
        clicks: 6,
        avgPosition: 4,
      },
    ], { platform: 'google' });

    expect(candidate.intent).toBe('negative');
    expect(candidate.tier).toBe('negative');
    expect(candidate.suggestedBidKrw).toBe(0);
  });

  it('never suggests a bid over the max CPC guardrail', () => {
    expect(suggestPaidBidKrw({ platform: 'google', tier: 'core', score: 900, maxCpcGuardKrw: 700 })).toBeLessThanOrEqual(700);
  });
});
