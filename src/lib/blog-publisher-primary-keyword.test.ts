import { describe, expect, it } from 'vitest';
import { choosePublisherPrimaryKeyword } from './blog-publisher-primary-keyword';

describe('choosePublisherPrimaryKeyword', () => {
  it('keeps compound product destinations broad enough to avoid single-city stuffing', () => {
    expect(choosePublisherPrimaryKeyword({
      source: 'product',
      productId: 'pkg-1',
      destination: '다낭/호이안',
      itemPrimaryKeyword: '다낭/호이안 LJ-599 초특가 상품명 전체',
      generatedPrimaryKeyword: null,
      topic: '다낭/호이안 패키지',
    })).toBe('다낭 호이안 패키지');
  });

  it('prefers a short generated product SEO keyword when available', () => {
    expect(choosePublisherPrimaryKeyword({
      source: 'product',
      productId: 'pkg-1',
      destination: '시즈오카/카와구치',
      itemPrimaryKeyword: '시즈오카/카와구치 긴 상품명 긴 상품명 긴 상품명 긴 상품명',
      generatedPrimaryKeyword: '시즈오카 카와구치 3일 패키지',
      topic: '시즈오카 패키지',
    })).toBe('시즈오카 카와구치 3일 패키지');
  });

  it('does not run keyword density for pillar pages', () => {
    expect(choosePublisherPrimaryKeyword({
      source: 'pillar',
      destination: '괌',
      itemPrimaryKeyword: '괌 여행',
      topic: '괌 여행 가이드',
    })).toBeNull();
  });
});
