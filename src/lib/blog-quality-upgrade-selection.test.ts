import { describe, expect, it } from 'vitest';
import {
  classifyBlogQualityUpgradeTopic,
  deduplicateBlogQualityUpgradeCandidates,
  getBlogQualityUpgradeExecutionMode,
  matchesBlogQualityUpgradeFilter,
} from './blog-quality-upgrade-selection';

describe('published blog quality upgrade topic selection', () => {
  it.each([
    ['다낭-6월-날씨와-옷차림-완벽-가이드', 'monthly_weather', 'weather_packing'],
    ['나트랑-달랏-화폐-환전-팁-문화-총정리', 'currency_payment', null],
    ['세부-공항에서-시내-이동-교통편', 'airport_transport', 'airport_arrival'],
    ['캐나다-로키산맥-렌터카-없이-대중교통-여행', 'local_transport', 'local_mobility'],
    ['괌-가족-4박5일-예산과-비용', 'family_budget', 'budget_family'],
    ['오사카-아이와-3박4일-여행-일정', 'itinerary', 'kid_friendly'],
  ])('accepts an explicit legacy topic: %s', (slug, expectedIntent, microAngle) => {
    expect(classifyBlogQualityUpgradeTopic({ slug })).toMatchObject({
      accepted: true,
      expectedIntent,
      microAngle,
    });
  });

  it.each([
    'cebu-complete-guide',
    'busan-danang-shilla-monogram-package-cn',
    '6월-유럽-여행-성수기-전-항공권-저렴하게-예약하는-팁',
    '나가사키-여행-준비물-완벽-체크리스트',
  ])('keeps an ambiguous or broad topic out of automatic rewriting: %s', (slug) => {
    expect(classifyBlogQualityUpgradeTopic({ slug })).toEqual({
      accepted: false,
      expectedIntent: null,
      microAngle: null,
      reason: 'ambiguous_or_general_topic',
    });
  });

  it('rejects a legacy URL and SEO title that promise different article intents', () => {
    expect(classifyBlogQualityUpgradeTopic({
      slug: '세부-6월-날씨와-옷차림',
      seoTitle: '세부 가족여행 예산과 실제 비용',
    })).toMatchObject({
      accepted: false,
      reason: 'conflicting_public_topic_signals',
    });
  });

  it.each([
    '괌-가족여행-아이와-함께-즐길-수-있는-액티비티-추천-best-5',
    'southeast-asia-danang-boracay-kotakinabalu-comparison-2026',
  ])('requires review for comparisons and listicles: %s', (slug) => {
    expect(classifyBlogQualityUpgradeTopic({ slug })).toMatchObject({
      accepted: false,
      reason: 'comparison_or_listicle_requires_review',
    });
  });

  it('keeps the first, oldest candidate for each representative identity', () => {
    const result = deduplicateBlogQualityUpgradeCandidates(
      [
        { id: 'oldest-weather', key: 'v1|danang|monthly_weather|general|ko-KR' },
        { id: 'newer-weather', key: 'v1|danang|monthly_weather|general|ko-KR' },
        { id: 'currency', key: 'v1|danang|currency_payment|general|ko-KR' },
      ],
      candidate => candidate.key,
    );

    expect(result.selected.map(candidate => candidate.id)).toEqual([
      'oldest-weather',
      'currency',
    ]);
    expect(result.duplicateCount).toBe(1);
  });

  it.each([
    ['weather', 'monthly_weather', 'weather_packing'],
    ['currency', 'currency_payment', null],
    ['currency_payment', 'currency_payment', null],
    ['local_mobility', 'local_transport', 'local_mobility'],
    ['transport', 'airport_transport', 'airport_arrival'],
    ['transport', 'local_transport', 'local_mobility'],
  ])('supports operator intent and micro-angle filters: %s', (filter, intent, microAngle) => {
    expect(matchesBlogQualityUpgradeFilter({
      filter,
      intent: intent as Parameters<typeof matchesBlogQualityUpgradeFilter>[0]['intent'],
      microAngle,
    })).toBe(true);
  });

  it('does not include a different intent in a reviewed batch', () => {
    expect(matchesBlogQualityUpgradeFilter({
      filter: 'currency',
      intent: 'monthly_weather',
      microAngle: 'weather_packing',
    })).toBe(false);
  });

  it.each([
    ['monthly_weather', 'deterministic'],
    ['entry_requirements', 'human_review'],
    ['travel_insurance', 'human_review'],
    ['currency_payment', 'unsupported'],
  ])('routes %s upgrades through %s execution', (intent, mode) => {
    expect(getBlogQualityUpgradeExecutionMode(
      intent as Parameters<typeof getBlogQualityUpgradeExecutionMode>[0],
    )).toBe(mode);
  });
});
