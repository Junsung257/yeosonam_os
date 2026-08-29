import { describe, expect, it } from 'vitest';
import {
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
});
