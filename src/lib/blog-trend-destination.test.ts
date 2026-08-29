import { describe, expect, it } from 'vitest';
import { buildBlogInformationContract } from './blog-information-contract';
import {
  buildBlogTrendCandidateTopic,
  buildSupportedBlogTrendDestinations,
  isSupportedBlogTrendDestination,
} from './blog-trend-destination';

describe('blog trend destination support', () => {
  it('accepts a destination backed by either an active package or a published blog corpus', () => {
    const supported = buildSupportedBlogTrendDestinations({
      activeCatalogDestinations: ['다낭'],
      publishedBlogDestinations: ['발리', ' 방콕 '],
    });

    expect(isSupportedBlogTrendDestination('다낭', supported)).toBe(true);
    expect(isSupportedBlogTrendDestination('발리', supported)).toBe(true);
    expect(isSupportedBlogTrendDestination('방콕', supported)).toBe(true);
    expect(isSupportedBlogTrendDestination('푸켓', supported)).toBe(false);
  });

  it('normalizes Unicode and whitespace before matching', () => {
    const supported = buildSupportedBlogTrendDestinations({
      activeCatalogDestinations: [],
      publishedBlogDestinations: ['  호찌민  시내 '],
    });

    expect(isSupportedBlogTrendDestination('호찌민 시내', supported)).toBe(true);
  });

  it('turns a generic travel trend into an explicit publishable preparation intent', () => {
    const topic = buildBlogTrendCandidateTopic({
      keyword: '발리 여행',
      destination: '발리',
    });

    expect(topic).toBe('발리 여행 준비물 체크리스트와 출발 전 확인사항');
    expect(buildBlogInformationContract({
      topic,
      primaryKeyword: '발리 여행',
      destination: '발리',
      category: 'travel_tips',
    }).passed).toBe(true);
  });
});
