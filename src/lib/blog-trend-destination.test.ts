import { describe, expect, it } from 'vitest';
import { buildBlogInformationContract } from './blog-information-contract';
import {
  buildClaimedMonthlyWeatherTrendDestinations,
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

  it('turns a generic travel trend into the one reviewed-source-backed monthly weather representative', () => {
    const topic = buildBlogTrendCandidateTopic({
      keyword: '발리 여행',
      destination: '발리',
      now: new Date('2026-08-29T17:00:00.000Z'),
    });

    expect(topic).toBe('발리 월별 날씨와 옷차림 준비물 체크리스트');
    expect(buildBlogInformationContract({
      topic,
      primaryKeyword: '발리 월별 날씨와 옷차림',
      destination: '발리',
      category: 'travel_tips',
    }).passed).toBe(true);
    expect(buildBlogTrendCandidateMeta(topic)).toEqual({
      expected_slug: 'bali-weather-preparation',
      micro_angle: 'weather_packing',
    });
  });

  it('does not let an explicit trend month create a second weather representative', () => {
    expect(buildBlogTrendCandidateTopic({
      keyword: '방콕 11월 날씨',
      destination: '방콕',
      now: new Date('2026-08-29T17:00:00.000Z'),
    })).toBe('방콕 월별 날씨와 옷차림 준비물 체크리스트');
  });

  it('normalizes only active general Korean monthly-weather representatives as claimed', () => {
    expect([...buildClaimedMonthlyWeatherTrendDestinations([
      { destination_id: ' 발리 ', intent: 'monthly_weather', audience: 'general', locale: 'ko-KR', status: 'active' },
      { destination_id: '방콕', intent: 'airport_transport', audience: 'general', locale: 'ko-KR', status: 'active' },
      { destination_id: '괌', intent: 'monthly_weather', audience: 'family', locale: 'ko-KR', status: 'active' },
      { destination_id: '도쿄', intent: 'monthly_weather', audience: 'general', locale: 'ko-KR', status: 'reserved' },
    ])]).toEqual(['발리']);
  });
});
