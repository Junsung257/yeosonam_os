import { describe, expect, it } from 'vitest';
import {
  buildPaidKeywordFamilyKey,
  buildSearchTermGrowthPlan,
  type ExistingKeywordPlanSignal,
  type SearchTermGrowthCandidate,
  type SearchTermGrowthPackage,
} from './ad-os-search-term-growth';

const packages: SearchTermGrowthPackage[] = [
  { id: 'pkg-danang', title: 'Danang family package', destination: 'danang', shortCode: 'DAD-01' },
  { id: 'pkg-osaka', title: 'Osaka parents package', destination: 'osaka', shortCode: 'OSA-01' },
];

describe('ad-os-search-term-growth', () => {
  it('promotes winning search terms into guarded keyword drafts', () => {
    const candidates: SearchTermGrowthCandidate[] = [
      {
        id: 'term-1',
        platform: 'google',
        searchTerm: 'danang family package june',
        parentKeyword: 'danang package',
        action: 'add_keyword',
        impressions: 300,
        clicks: 20,
        costKrw: 9000,
        conversions: 2,
        score: 88,
      },
    ];
    const existingPlans: ExistingKeywordPlanSignal[] = [
      { packageId: 'pkg-danang', platform: 'google', keywordText: 'danang package', matchType: 'phrase', tier: 'core' },
    ];

    const plan = buildSearchTermGrowthPlan(candidates, {
      packages,
      existingPlans,
      maxCpcByPlatform: { google: 700 },
    });

    expect(plan.keywordDrafts).toHaveLength(1);
    expect(plan.keywordDrafts[0].packageId).toBe('pkg-danang');
    expect(plan.keywordDrafts[0].suggestedBidKrw).toBeLessThanOrEqual(700);
    expect(plan.summary.external_spend_krw).toBe(0);
  });

  it('turns safe waste terms into negative drafts', () => {
    const plan = buildSearchTermGrowthPlan([
      {
        id: 'term-2',
        platform: 'naver',
        searchTerm: 'osaka hotel only',
        parentKeyword: 'osaka package',
        action: 'add_negative',
        impressions: 5000,
        clicks: 30,
        costKrw: 40000,
        conversions: 0,
        score: 76,
      },
    ], {
      packages,
      existingPlans: [
        { packageId: 'pkg-osaka', platform: 'naver', keywordText: 'osaka package', matchType: 'phrase', tier: 'core' },
      ],
    });

    expect(plan.negativeDrafts).toHaveLength(1);
    expect(plan.negativeDrafts[0].tier).toBe('negative');
    expect(plan.negativeDrafts[0].suggestedBidKrw).toBe(0);
  });

  it('blocks duplicate semantic families', () => {
    const familyKey = buildPaidKeywordFamilyKey('danang family package june');
    expect(familyKey).toContain('danang');

    const plan = buildSearchTermGrowthPlan([
      {
        id: 'term-3',
        platform: 'google',
        searchTerm: 'danang family package june',
        action: 'add_keyword',
        impressions: 100,
        clicks: 10,
        costKrw: 3000,
        conversions: 1,
        score: 80,
      },
    ], {
      packages,
      existingPlans: [
        {
          packageId: 'pkg-danang',
          platform: 'google',
          keywordText: 'danang family package june',
          matchType: 'exact',
          tier: 'longtail',
        },
      ],
    });

    expect(plan.keywordDrafts).toHaveLength(0);
    expect(plan.summary.blocked_duplicates).toBe(1);
  });
});
