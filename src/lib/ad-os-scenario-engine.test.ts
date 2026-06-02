import { describe, expect, it } from 'vitest';
import { deriveAdOsProductScenarios, scenariosToExtractedKeywords } from '@/lib/ad-os-scenario-engine';
import type { TravelPackageForSearchAds } from '@/lib/search-ads-auto-planner';

function pkg(overrides: Partial<TravelPackageForSearchAds> = {}): TravelPackageForSearchAds {
  return {
    id: 'pkg-danang-001',
    title: '부산출발 에어부산 다낭 노쇼핑 부모님 패키지',
    destination: '다낭',
    duration: 4,
    nights: 3,
    price: 599000,
    departure_airport: '부산',
    airline: '에어부산',
    product_type: 'package',
    inclusions: ['노쇼핑', '호이안', '가이드'],
    itinerary: ['다낭', '호이안', '바나힐'],
    ...overrides,
  };
}

describe('deriveAdOsProductScenarios', () => {
  it('creates travel-specific ultra-longtail scenarios from product facts', () => {
    const scenarios = deriveAdOsProductScenarios(pkg());
    const types = scenarios.map((scenario) => scenario.scenarioType);
    const keywords = scenarios.flatMap((scenario) => [scenario.primaryKeyword, ...scenario.keywordVariants]);

    expect(types).toContain('regional_departure');
    expect(types).toContain('airline');
    expect(types).toContain('filial');
    expect(types).toContain('price_objection');
    expect(types).toContain('differentiator');
    expect(types).toContain('retargeting');
    expect(keywords).toContain('부산에서 출발하는 다낭');
    expect(keywords).toContain('에어부산 다낭');
    expect(keywords).toContain('부모님 여행은 어디가 좋을까 다낭');
    expect(keywords).toContain('다낭 환전 팁');
  });

  it('routes duplicate-prone comparison intent to hub/update strategies instead of unlimited new blogs', () => {
    const scenarios = deriveAdOsProductScenarios(pkg());
    const comparison = scenarios.find((scenario) => scenario.scenarioType === 'comparison');
    const family = scenarios.find((scenario) => scenario.scenarioType === 'filial');

    expect(comparison?.landingStrategy).toBe('hub_page');
    expect(family?.landingStrategy).toBe('blog_update');
    expect(comparison?.riskFlags).toMatchObject({ evergreen_hub_preferred: true });
  });

  it('converts scenarios into cautious search ad keyword plans', () => {
    const keywords = scenariosToExtractedKeywords(deriveAdOsProductScenarios(pkg()));

    expect(keywords.length).toBeGreaterThan(10);
    expect(keywords.some((keyword) => keyword.keyword === '부산 출발 다낭 패키지')).toBe(true);
    expect(keywords.find((keyword) => keyword.keyword === '부산 출발 다낭 패키지')).toMatchObject({
      matchType: 'exact',
      tier: 'longtail',
      suggestedBid: 180,
    });
  });
});
