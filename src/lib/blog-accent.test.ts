import { describe, it, expect } from 'vitest';
import { normalizeRangeDashes, applyMarkdownAccents } from './blog-accent';

/**
 * 회귀 fixture — 2026-05-17 PR #105 세부 6월 블로그 사고
 *
 * 사고 패턴: marked.js GFM strikethrough 의 실제 regex 가 `~+` greedy 매치라
 *   `25~32℃ ... 30분~1시간 ... 평일(화~목)` 처럼 본문에 흩어진 단일 `~` 쌍이
 *   통째로 <del> 으로 묶이는 폭주가 났다.
 *
 * 회귀 보호 원칙:
 *   1. 모든 단일 `~` → en-dash(`–`)
 *   2. 정상 `~~text~~` strikethrough 는 보존
 *   3. code span / fenced code 내부의 `~` (예: `~/.bashrc`) 는 보존
 *   4. 한글/숫자/공백 어디서든 동작
 */

describe('normalizeRangeDashes', () => {
  describe('숫자~숫자 범위', () => {
    it('소수·단위 포함 범위', () => {
      expect(normalizeRangeDashes('25~32℃')).toBe('25–32℃');
      expect(normalizeRangeDashes('0.5~1m')).toBe('0.5–1m');
      expect(normalizeRangeDashes('30~40% 저렴')).toBe('30–40% 저렴');
    });
    it('쉼표 포함 숫자', () => {
      expect(normalizeRangeDashes('12,000~15,000원')).toBe('12,000–15,000원');
    });
  });

  describe('단위 사이 ~ (좁은 정규식이 못 잡던 패턴)', () => {
    it('숫자 + 한글 단위 사이 ~', () => {
      expect(normalizeRangeDashes('30분~1시간')).toBe('30분–1시간');
      expect(normalizeRangeDashes('3박~5박')).toBe('3박–5박');
    });
    it('월 단위 범위', () => {
      expect(normalizeRangeDashes('12~5월')).toBe('12–5월');
      expect(normalizeRangeDashes('7~10월')).toBe('7–10월');
    });
    it('시간대 범위', () => {
      expect(normalizeRangeDashes('오전 9~11시')).toBe('오전 9–11시');
      expect(normalizeRangeDashes('오후 2~5시')).toBe('오후 2–5시');
    });
  });

  describe('한글~한글 (요일·관계 표기)', () => {
    it('요일 범위', () => {
      expect(normalizeRangeDashes('평일(화~목)')).toBe('평일(화–목)');
      expect(normalizeRangeDashes('월~금')).toBe('월–금');
    });
  });

  describe('정상 ~~strikethrough~~ 보존', () => {
    it('단독 strikethrough', () => {
      expect(normalizeRangeDashes('~~삭제선~~')).toBe('~~삭제선~~');
    });
    it('strikethrough + 범위 혼재', () => {
      expect(normalizeRangeDashes('~~예전가격~~ 25~30만원')).toBe('~~예전가격~~ 25–30만원');
    });
  });

  describe('code 보호', () => {
    it('inline code 안의 ~ 는 그대로', () => {
      expect(normalizeRangeDashes('`~/.bashrc` 파일')).toBe('`~/.bashrc` 파일');
    });
    it('fenced code 안의 ~ 는 그대로', () => {
      const input = '본문 25~30\n```\n~/snap 디렉토리\n```\n뒤 5~10';
      const out = normalizeRangeDashes(input);
      expect(out).toContain('25–30');
      expect(out).toContain('5–10');
      expect(out).toContain('~/snap'); // code 내부 보존
    });
  });

  describe('실제 세부 6월 글 사고 fixture (라이브 본문 발췌)', () => {
    const sampleBody = `평균 기온은 25~32℃, 강수량은 200mm 내외입니다.
6월 세부는 장대비보다 30분~1시간 단위 스콜이 주를 이루어
오전 9~11시 사이에 스노클링 일정을 잡으시는 게 좋아요.
평일(화~목)으로 잡으시면 1.5배 비싼 주말 요금을 피할 수 있어요.`;
    it('변환 후 단일 ~ 가 0개', () => {
      const out = normalizeRangeDashes(sampleBody);
      // 코드/이중 ~ 외엔 모두 en-dash 로 변환되어야 함
      expect(out).not.toContain('~');
      // en-dash 5개 (25–32, 30분–1시간, 9–11, 화–목, 그리고 200mm 는 미포함)
      const endashCount = (out.match(/–/g) || []).length;
      expect(endashCount).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('빈 문자열', () => {
      expect(normalizeRangeDashes('')).toBe('');
    });
    it('~ 없는 본문은 그대로', () => {
      expect(normalizeRangeDashes('일반 본문')).toBe('일반 본문');
    });
  });
});

describe('applyMarkdownAccents (normalizeRangeDashes integration)', () => {
  it('range 변환 + ==highlight== 함께 적용', () => {
    const md = '평균 ==25~32℃== 입니다';
    const out = applyMarkdownAccents(md);
    expect(out).toBe('평균 <mark>25–32℃</mark> 입니다');
  });
  it(':::tip 블록 + range 동시 적용', () => {
    const md = ':::tip\n오전 9~11시 추천\n:::';
    const out = applyMarkdownAccents(md);
    expect(out).toContain('9–11시');
    expect(out).toContain('<aside class="tip">');
  });
});
