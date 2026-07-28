import { describe, expect, it } from 'vitest';
import { evaluatePublishedBlogQualityUpgradeCandidate } from './blog-quality-upgrade-candidate';

describe('published blog quality upgrade candidate', () => {
  it('builds one safe representative identity from an explicit destination intent', () => {
    const decision = evaluatePublishedBlogQualityUpgradeCandidate({
      id: 'post-1',
      slug: 'cebu-june-weather-packing',
      seo_title: '세부 6월 날씨와 옷차림',
      destination: '세부',
      category: 'weather',
    });

    expect(decision).toMatchObject({
      accepted: true,
      reason: 'safe_automatic_candidate',
      microAngle: 'weather_packing',
      brief: {
        intentType: 'monthly_weather',
        passed: true,
        requiresHumanReview: false,
      },
    });
    expect(decision.representativeKey).toContain('monthly_weather');
  });

  it('rejects broad guides before they enter an automatic rewrite queue', () => {
    const decision = evaluatePublishedBlogQualityUpgradeCandidate({
      id: 'post-2',
      slug: 'cebu-complete-guide',
      seo_title: '세부 여행 완벽 가이드',
      destination: '세부',
      category: 'travel_tips',
    });

    expect(decision).toMatchObject({
      accepted: false,
      reason: 'ambiguous_or_general_topic',
      representativeKey: null,
    });
  });

  it('rejects otherwise explicit topics without a destination', () => {
    const decision = evaluatePublishedBlogQualityUpgradeCandidate({
      id: 'post-3',
      slug: 'june-weather-packing',
      seo_title: '6월 날씨와 옷차림',
      destination: null,
      category: 'weather',
    });

    expect(decision).toMatchObject({
      accepted: false,
      reason: 'missing_destination',
    });
  });
});
