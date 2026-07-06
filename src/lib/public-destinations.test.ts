import { describe, expect, it } from 'vitest';
import {
  canonicalizePublicDestination,
  getPublicDestinationQueryNames,
  isProductLikeDestination,
  mergePublicDestinationStats,
  slugMatchesPublicDestination,
} from './public-destinations';

describe('public destination normalization', () => {
  it('folds product-like destination names into public destination hubs', () => {
    expect(canonicalizePublicDestination('북해도 스팟특가 4일')).toBe('북해도');
    expect(canonicalizePublicDestination('부산-계림 실속')).toBe('계림');
    expect(canonicalizePublicDestination('노팁/노옵션 특급호텔 청도+맥주박물관')).toBe('청도');
  });

  it('folds compound course names into their representative public destination', () => {
    expect(canonicalizePublicDestination('다낭/호이안')).toBe('다낭');
    expect(canonicalizePublicDestination('나트랑/달랏')).toBe('나트랑');
    expect(canonicalizePublicDestination('방콕 & 파타야')).toBe('방콕');
  });

  it('keeps real standalone destinations public', () => {
    expect(canonicalizePublicDestination('푸꾸옥')).toBe('푸꾸옥');
    expect(canonicalizePublicDestination('후쿠오카')).toBe('후쿠오카');
    expect(canonicalizePublicDestination('보홀')).toBe('보홀');
  });

  it('exposes aliases for data lookups and old route compatibility', () => {
    expect(getPublicDestinationQueryNames('북해도')).toEqual(expect.arrayContaining(['북해도', '북해도 스팟특가 4일', '북해도 품격팩']));
    expect(slugMatchesPublicDestination('다낭/호이안', '다낭')).toBe(true);
    expect(slugMatchesPublicDestination('하노이/하롱베이/옌뜨', '하노이-하롱베이-옌뜨')).toBe(true);
  });

  it('merges active destination rows without losing counts or lowest prices', () => {
    const merged = mergePublicDestinationStats([
      { destination: '북해도 스팟특가 4일', package_count: 2, min_price: 920000 },
      { destination: '북해도 품격팩', package_count: 2, min_price: 1000000 },
      { destination: '북해도 알짜팩', package_count: 1, min_price: 750000 },
      { destination: '푸꾸옥', package_count: 31, min_price: 729000 },
    ]);

    expect(merged.find((row) => row.destination === '북해도')).toMatchObject({
      package_count: 5,
      min_price: 750000,
    });
    expect(merged.find((row) => row.destination === '푸꾸옥')).toMatchObject({
      package_count: 31,
      min_price: 729000,
    });
  });

  it('identifies rows that should not become separate public destination cards', () => {
    expect(isProductLikeDestination('북해도 핵심알짜팩')).toBe(true);
    expect(isProductLikeDestination('청도 2색골프')).toBe(true);
    expect(isProductLikeDestination('푸꾸옥')).toBe(false);
  });
});

