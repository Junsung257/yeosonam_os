import { describe, expect, it } from 'vitest';
import { generateRecommendationCopy, isWeakCopy } from './recommendation-copy';

/**
 * 2026-05-19 박제: recommendation-copy.ts 회귀 fixture.
 *
 * 사장님 사고: "부관훼리를 이용한 초특가 가성비 무박3일 패키지 여행" 같은 무의미 카피.
 * generateRecommendationCopy + isWeakCopy 박제 — 다음 PR 가드 풀면 즉시 회귀.
 */

describe('generateRecommendationCopy — 결정적 카피', () => {
  it('완전 입력 → 표준 양식', () => {
    const r = generateRecommendationCopy({
      destination: '대만',
      duration: 4,
      departure: '부산',
      airline: 'BX',
      inclusions: ['왕복 항공료', '호텔'],
      product_highlights: ['101빌딩 전망대', '발마사지 30분'],
    });
    expect(r).toContain('부산');
    expect(r).toContain('대만');
    expect(r).toContain('4일');
    expect(r).toContain('101빌딩');
  });

  it('product_highlights 우선', () => {
    const r = generateRecommendationCopy({
      destination: '베트남',
      duration: 5,
      product_highlights: ['옌뜨 케이블카', '하롱베이 크루즈'],
      inclusions: ['호텔', '식사'],
    });
    expect(r).toContain('옌뜨 케이블카');
    expect(r).toContain('하롱베이 크루즈');
  });

  it('cruise 타입 → ferry name 앞에 박힘', () => {
    const r = generateRecommendationCopy({
      destination: '시모노세키',
      duration: 3,
      departure: '부산',
      product_type: 'cruise',
      airline: '부관훼리',
    });
    expect(r).toContain('부관훼리 이용');
  });

  it('destination만 → 최소 카피', () => {
    const r = generateRecommendationCopy({ destination: '몽골' });
    expect(r).toBe('몽골 여행');
  });

  it('전부 빈값 → 폴백 카피', () => {
    const r = generateRecommendationCopy({});
    expect(r).toBe('여행 패키지');
  });

  it('airline 중복 차단 (이미 destination에 있음)', () => {
    const r = generateRecommendationCopy({
      destination: '대만',
      duration: 4,
      departure: 'BX 부산',
      airline: 'BX',
    });
    // BX 가 departure 에 이미 있으면 다시 안 박음
    const bxCount = (r.match(/BX/g) ?? []).length;
    expect(bxCount).toBeLessThanOrEqual(1);
  });
});

describe('isWeakCopy — 무의미 카피 감지 (부관훼리 사고)', () => {
  it('null/undefined/빈 문자열 → 약함', () => {
    expect(isWeakCopy(null)).toBe(true);
    expect(isWeakCopy(undefined)).toBe(true);
    expect(isWeakCopy('')).toBe(true);
  });

  it('20자 미만 → 약함', () => {
    expect(isWeakCopy('짧은 카피')).toBe(true);
  });

  it('"...패키지 여행" 만 끝남 → 약함 (부관훼리 사고 패턴)', () => {
    expect(isWeakCopy('초특가 가성비 패키지 여행')).toBe(true);
  });

  it('title 재서술 (30자 추가 없음) → 약함', () => {
    const title = '[부관훼리] 초특가 가성비 무박3일 PKG';
    const copy = '초특가 가성비 무박3일 PKG 여행';
    expect(isWeakCopy(copy, title)).toBe(true);
  });

  it('실제 셀링포인트 포함 → 강함', () => {
    const copy = '부산 출발 4일 대만 여행 — 101빌딩 전망대 + 발마사지 30분';
    expect(isWeakCopy(copy)).toBe(false);
  });
});
