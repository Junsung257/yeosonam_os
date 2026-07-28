import { describe, expect, it } from 'vitest';

import { buildBlogCategoryScorecard } from './blog-category-scorecard';

describe('blog category scorecard', () => {
  it('uses the weakest publishing dimension instead of hiding failures in averages', () => {
    const [weather] = buildBlogCategoryScorecard([
      {
        category: 'monthly_weather',
        publishReady: true,
        researchRequired: true,
        researchVerified: true,
        seoScore: 100,
        readabilityScore: 100,
        engineScore: 100,
        componentFloor: 100,
        imageCount: 3,
      },
      {
        category: 'monthly_weather',
        publishReady: false,
        researchRequired: true,
        researchVerified: false,
        seoScore: 94,
        readabilityScore: 100,
        engineScore: 100,
        componentFloor: 95,
        imageCount: 3,
      },
    ]);

    expect(weather).toMatchObject({
      publishReadyRate: 50,
      researchCoverage: 50,
      minimumSeoScore: 94,
      score: 50,
      passed95: false,
    });
  });

  it('passes only when every enforced category floor is at least 95', () => {
    const [entry] = buildBlogCategoryScorecard([{
      category: 'entry_requirements',
      publishReady: true,
      researchRequired: true,
      researchVerified: true,
      seoScore: 95,
      readabilityScore: 100,
      engineScore: 100,
      componentFloor: 95,
      imageCount: 3,
    }]);

    expect(entry).toMatchObject({
      score: 95,
      passed95: true,
      researchCoverage: 100,
      imageCoverage: 100,
    });
  });

  it('treats missing measurements as zero instead of silently excluding them', () => {
    const [legacy] = buildBlogCategoryScorecard([{
      category: 'legacy',
      publishReady: true,
      researchRequired: true,
      researchVerified: false,
      seoScore: null,
      readabilityScore: 100,
      engineScore: 100,
      componentFloor: 100,
      imageCount: 3,
    }]);

    expect(legacy.score).toBe(0);
    expect(legacy.passed95).toBe(false);
  });
});
