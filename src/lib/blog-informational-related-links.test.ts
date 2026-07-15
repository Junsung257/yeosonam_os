import { describe, expect, it } from 'vitest';
import {
  rankBlogInformationalRelatedLinks,
  readBlogInformationalLinkCandidate,
  type BlogInformationalLinkCandidate,
  type BlogInformationalLinkContext,
} from './blog-informational-related-links';

const source: BlogInformationalLinkContext = {
  slug: 'sapporo-food-budget',
  title: '삿포로 식비 가이드',
  destination: '삿포로',
  destinationId: 'sapporo',
  intent: 'food_budget',
  audience: 'general',
  locale: 'ko-KR',
};

function candidate(
  overrides: Partial<BlogInformationalLinkCandidate>,
): BlogInformationalLinkCandidate {
  return {
    id: overrides.slug || 'candidate',
    slug: 'sapporo-payment',
    title: '삿포로 환전과 결제 가이드',
    destination: '삿포로',
    destinationId: 'sapporo',
    intent: 'currency_payment',
    audience: 'general',
    locale: 'ko-KR',
    status: 'published',
    ...overrides,
  };
}

describe('rankBlogInformationalRelatedLinks', () => {
  it('does not recommend Phu Quoc or Guangzhou to a Sapporo food article', () => {
    const result = rankBlogInformationalRelatedLinks(source, [
      candidate({
        id: 'phu-quoc-food',
        slug: 'phu-quoc-food',
        title: '푸꾸옥 식비',
        destination: '푸꾸옥',
        destinationId: 'phu-quoc',
        intent: 'food_budget',
      }),
      candidate({
        id: 'guangzhou-food',
        slug: 'guangzhou-food',
        title: '광저우 식비',
        destination: '광저우',
        destinationId: 'guangzhou',
        intent: 'food_budget',
      }),
    ]);

    expect(result).toEqual([]);
  });

  it('returns an empty list when no candidate meets the relevance threshold', () => {
    expect(rankBlogInformationalRelatedLinks(source, [])).toEqual([]);
    expect(rankBlogInformationalRelatedLinks(source, [
      candidate({
        slug: 'singapore-weather',
        destination: '싱가포르',
        destinationId: 'singapore',
        intent: 'monthly_weather',
      }),
    ])).toEqual([]);
  });

  it('prioritizes same-destination adjacent intent over country and region matches', () => {
    const result = rankBlogInformationalRelatedLinks(source, [
      candidate({
        slug: 'osaka-food',
        title: '오사카 식비 가이드',
        destination: '오사카',
        destinationId: 'osaka',
        intent: 'food_budget',
      }),
      candidate({ slug: 'sapporo-payment' }),
    ]);

    expect(result.map((entry) => entry.candidate.slug)).toEqual([
      'sapporo-payment',
      'osaka-food',
    ]);
    expect(result[0]?.reasons).toContain('same_destination_adjacent_intent');
    expect(result[1]?.reasons).toContain('same_country_same_intent');
  });

  it('excludes unpublished, noindex, redirect, non-canonical, duplicate, and self URLs', () => {
    const result = rankBlogInformationalRelatedLinks(source, [
      candidate({ slug: source.slug }),
      candidate({ slug: 'draft', status: 'draft' }),
      candidate({ slug: 'noindex', noindex: true }),
      candidate({ slug: 'redirect', redirectTo: '/blog/canonical' }),
      candidate({ slug: 'non-canonical', canonicalSlug: 'canonical' }),
      candidate({ slug: 'kept' }),
      candidate({ id: 'duplicate-row', slug: 'kept', title: '중복 행' }),
    ]);

    expect(result.map((entry) => entry.candidate.slug)).toEqual(['kept']);
  });

  it('allows a specific audience and editorial cluster to create relevance', () => {
    const familySource = { ...source, audience: 'family' as const, clusterId: 'family-planning' };
    const result = rankBlogInformationalRelatedLinks(familySource, [
      candidate({
        slug: 'phu-quoc-family',
        destination: '푸꾸옥',
        destinationId: 'phu-quoc',
        intent: 'itinerary',
        audience: 'family',
      }),
      candidate({
        slug: 'taipei-cluster',
        destination: '타이베이',
        destinationId: 'taipei',
        intent: 'monthly_weather',
        clusterId: 'family-planning',
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.reasons).toContain('same_specific_audience');
    expect(result[1]?.reasons).toContain('editorial_pillar_cluster');
  });

  it('does not repeat anchor text when titles collide', () => {
    const result = rankBlogInformationalRelatedLinks(source, [
      candidate({ slug: 'sapporo-payment-a', title: '2026 삿포로 결제 가이드' }),
      candidate({ slug: 'sapporo-payment-b', title: '2027 삿포로 결제 가이드' }),
    ]);

    expect(result).toHaveLength(2);
    expect(new Set(result.map((entry) => entry.anchorText)).size).toBe(2);
  });

  it('reads canonical and indexability metadata from the information contract', () => {
    const result = readBlogInformationalLinkCandidate({
      id: 'meta-candidate',
      slug: 'sapporo-weather',
      title: '삿포로 날씨',
      destination: '삿포로',
      status: 'published',
      generationMeta: {
        content_brief: {
          destination_id: 'sapporo',
          intent_type: 'monthly_weather',
          audience: 'general',
          locale: 'ko-KR',
        },
        seo: { noindex: true },
        information_representative: {
          canonical_slug: 'sapporo-weather-canonical',
          status: 'retired',
        },
      },
    });

    expect(result).toMatchObject({
      noindex: true,
      canonicalSlug: 'sapporo-weather-canonical',
      destinationId: 'sapporo',
      intent: 'monthly_weather',
    });
  });
});
