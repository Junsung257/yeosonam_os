import { describe, expect, it } from 'vitest';
import { buildBlogInformationContract } from './blog-information-contract';
import {
  buildBlogTrendCandidateMeta,
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

  it('turns a generic travel trend into a reviewed-source-backed next-month weather intent', () => {
    const topic = buildBlogTrendCandidateTopic({
      keyword: '발리 여행',
      destination: '발리',
      now: new Date('2026-08-29T17:00:00.000Z'),
    });

    expect(topic).toBe('발리 9월 날씨와 옷차림 준비물 체크리스트');
    expect(buildBlogInformationContract({
      topic,
      primaryKeyword: '발리 여행',
      destination: '발리',
      category: 'travel_tips',
    }).passed).toBe(true);
    expect(buildBlogTrendCandidateMeta(topic)).toEqual({
      expected_slug: 'bali-9-weather-preparation',
      micro_angle: 'weather_packing',
    });
  });

  it('preserves an explicit trend month instead of replacing it with the next month', () => {
    expect(buildBlogTrendCandidateTopic({
      keyword: '방콕 11월 날씨',
      destination: '방콕',
      now: new Date('2026-08-29T17:00:00.000Z'),
    })).toBe('방콕 11월 날씨와 옷차림 준비물 체크리스트');
  });
});
