import { describe, expect, it } from 'vitest';
import {
  buildQaPackageHintSource,
  extractQaDestinationHint,
  QA_KNOWN_DESTINATION_KEYWORDS,
} from './qa-destination-hint';

describe('extractQaDestinationHint', () => {
  it('본문에 목적지가 있으면 첫 매칭 키워드를 반환한다', () => {
    expect(extractQaDestinationHint('5월에 다낭 가고 싶어요')).toBe('다낭');
    // 키워드表 순서상 '오사카'가 '후쿠오카'보다 먼저라, 둘 다 있으면 오사카만 잡힌다
    expect(extractQaDestinationHint('후쿠오카 3박4일')).toBe('후쿠오카');
  });

  it('목적지가 없으면 null', () => {
    expect(extractQaDestinationHint('추천 좀 해줘')).toBeNull();
    expect(extractQaDestinationHint('')).toBeNull();
  });

  it('표에 있는 키워드는 모두 문자열에 포함 검사로 매칭', () => {
    for (const dest of QA_KNOWN_DESTINATION_KEYWORDS) {
      expect(extractQaDestinationHint(`${dest} 여행`)).toBe(dest);
    }
  });
});

describe('buildQaPackageHintSource', () => {
  it('현재 메시지 + 최근 user 발화를 합친다', () => {
    const history = [
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '무엇을 도와드릴까요' },
      { role: 'user', content: '다낭이 궁금해' },
    ];
    const src = buildQaPackageHintSource('가격대는 얼마야?', history);
    expect(src).toContain('가격대는 얼마야?');
    expect(src).toContain('다낭이 궁금해');
    expect(extractQaDestinationHint(src)).toBe('다낭');
  });

  it('빈 히스토리면 메시지만 사용', () => {
    expect(buildQaPackageHintSource('  장가계  ', [])).toBe('장가계');
  });
});
