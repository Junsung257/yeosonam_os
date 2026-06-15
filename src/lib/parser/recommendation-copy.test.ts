import { describe, expect, it } from 'vitest';
import { generateRecommendationCopy, isWeakCopy } from './recommendation-copy';

describe('generateRecommendationCopy', () => {
  it('generates customer-friendly golf copy with destination, stay, and trip style', () => {
    const copy = generateRecommendationCopy({
      title: 'BX 나트랑 다이아몬드베이 골프텔',
      destination: '나트랑',
      duration: 5,
      trip_style: '3박5일',
      airline: '에어부산',
      product_type: 'golf',
      product_highlights: ['다이아몬드CC 라운딩', '골프텔 숙박'],
    });

    expect(copy).toContain('⛳');
    expect(copy).toContain('나트랑을 편하게 즐기고 싶은 분');
    expect(copy).toContain('다이아몬드베이 골프텔');
    expect(copy).toContain('3박5일 안에서도');
    expect(copy).not.toContain('현지에서 따로 드는 비용');
    expect(copy).not.toContain('상담');
    expect(copy).not.toContain('배포');
  });

  it('generates ferry copy with carrier context', () => {
    const copy = generateRecommendationCopy({
      title: '대마도 자연과 역사탐방 2일',
      destination: '대마도',
      duration: 2,
      product_type: 'ferry',
      airline: '팬스타크루즈',
      product_highlights: ['히타카츠', '미우다 해변'],
    });

    expect(copy).toContain('🛳️');
    expect(copy).toContain('팬스타크루즈로 대마도까지');
    expect(copy).toContain('히타카츠');
  });

  it('generates onsen copy for hot-spring packages', () => {
    const copy = generateRecommendationCopy({
      title: '후쿠오카 벳부 유노하나 온천 3일',
      destination: '벳부',
      duration: 3,
      product_highlights: ['유노하나 재배지', '가마도 지옥순례'],
    });

    expect(copy).toContain('♨️');
    expect(copy).toContain('벳부의 온천');
    expect(copy).toContain('유노하나 재배지');
  });

  it('generates general package copy without raw internal distribution phrases', () => {
    const copy = generateRecommendationCopy({
      title: '선발특가 6/ 까지 6/4 배포 장가계 4일',
      destination: '장가계',
      duration: 4,
      product_type: 'package',
      product_highlights: ['천문산 케이블카', '원가계 풍경구'],
    });

    expect(copy).toContain('✈️');
    expect(copy).toContain('장가계를 처음 방문해도');
    expect(copy).toContain('천문산 케이블카');
    expect(copy).not.toContain('선발특가');
    expect(copy).not.toContain('배포');
    expect(copy).not.toContain('6/ 까지');
  });
});

describe('isWeakCopy', () => {
  it('treats empty and very short copy as weak', () => {
    expect(isWeakCopy(null)).toBe(true);
    expect(isWeakCopy(undefined)).toBe(true);
    expect(isWeakCopy('짧은 카피')).toBe(true);
  });

  it('treats internal distribution copy as weak', () => {
    expect(isWeakCopy('BX 5일 나트랑 다이아몬드베이 골프텔 선발특가 6/ 까지 배포 스팟특가 여행')).toBe(true);
  });

  it('treats cost-counseling language as weak for recommendation copy', () => {
    expect(isWeakCopy('현지에서 따로 드는 비용은 상담 때 한 번에 정리해드릴게요.')).toBe(true);
  });

  it('keeps specific customer-facing copy', () => {
    const copy = [
      '⛳ 골프를 중심으로 나트랑을 편하게 즐기고 싶은 분께 좋은 일정입니다.',
      '🏨 다이아몬드CC 골프텔에 머물며 라운딩 동선을 줄이고, 남는 시간은 휴식에 집중할 수 있어요.',
      '🌴 3박5일 안에서도 라운딩과 리조트형 휴식을 함께 기대할 수 있는 나트랑 골프 여행입니다.',
    ].join('\n\n');

    expect(isWeakCopy(copy)).toBe(false);
  });
});
