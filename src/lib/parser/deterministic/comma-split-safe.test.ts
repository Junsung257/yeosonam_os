import { describe, expect, it } from 'vitest';
import { looksLikeCommaSplitBroken } from './comma-split-signature';
import {
  formatExcludeDisplayLabel,
  repairMealDayExcludeItems,
  shouldSplitAtComma,
} from './comma-split-safe';

describe('shouldSplitAtComma', () => {
  it('천단위 콤마 보호', () => {
    const s = '수수료 2,000엔, 가이드팁';
    const idx = s.indexOf(',');
    expect(shouldSplitAtComma(s, idx)).toBe(false);
  });

  it('일차 나열 콤마 보호', () => {
    const s = '3,4일차중식,석식';
    const idx = s.indexOf(',');
    expect(shouldSplitAtComma(s, idx)).toBe(false);
  });

  it('일반 항목 콤마는 분리', () => {
    const s = '개인경비, 매너팁';
    const idx = s.indexOf(',');
    expect(shouldSplitAtComma(s, idx)).toBe(true);
  });
});

describe('looksLikeCommaSplitBroken', () => {
  it('고아 일차 숫자 감지', () => {
    expect(looksLikeCommaSplitBroken(['개인경비', '3', '4일차중식', '석식'])).toBe(true);
  });

  it('detects split thousands amounts', () => {
    expect(looksLikeCommaSplitBroken(['개인경비', '주말골프 추가금 18홀/15', '000원/인'])).toBe(true);
  });

  it('정상 excludes 는 false', () => {
    expect(looksLikeCommaSplitBroken(['개인경비', '3·4일차 중식, 석식', '5일차 석식'])).toBe(false);
  });
});

describe('formatExcludeDisplayLabel', () => {
  it('3박5일 원문 형태', () => {
    expect(formatExcludeDisplayLabel('3일차중식,석식')).toBe('3일차 중식, 석식');
    expect(formatExcludeDisplayLabel('4일차석식')).toBe('4일차 석식');
  });

  it('4박6일 원문 형태', () => {
    expect(formatExcludeDisplayLabel('3,4일차중식,석식')).toBe('3·4일차 중식, 석식');
    expect(formatExcludeDisplayLabel('5일차석식')).toBe('5일차 석식');
  });
});

describe('repairMealDayExcludeItems', () => {
  it('고아 숫자+일차 복원', () => {
    expect(repairMealDayExcludeItems(['3', '4일차중식', '석식'])).toEqual(['3·4일차 중식, 석식']);
  });
});
