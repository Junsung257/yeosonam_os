/**
 * llm-retry 단위 테스트 — stripMarkdownJson SAP 파서 회귀 방지
 *
 * SAP(Schema-Aligned Parsing) 패턴은 LLM 응답이 다음 형태로 와도 안전하게 JSON
 * 본체를 추출해야 한다 — 이 테스트가 깨지면 callWithZodValidation 의 1차 파싱
 * 통과율이 떨어져 토큰 비용 증가 + 정확도 하락으로 직결.
 *
 * 커버:
 *   - 코드펜스 / leading prose / trailing prose / embedded fence
 *   - 잘린 응답 (truncated array, unclosed string, trailing comma)
 *   - 정상 입력 통과 (하위호환)
 */

import { describe, it, expect } from 'vitest';
import { stripMarkdownJson } from './llm-retry';

describe('stripMarkdownJson — BAML SAP 파서', () => {
  it('정상 JSON 은 변형 없이 통과', () => {
    expect(stripMarkdownJson('{"a":1}')).toBe('{"a":1}');
  });

  it('```json 코드펜스 제거', () => {
    expect(stripMarkdownJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('``` 코드펜스 (json 라벨 없음) 제거', () => {
    expect(stripMarkdownJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leading prose 제거 — 첫 { 부터', () => {
    expect(stripMarkdownJson('여기 결과입니다: {"a":1}')).toBe('{"a":1}');
  });

  it('trailing prose 제거 — 매칭 } 까지', () => {
    expect(stripMarkdownJson('{"a":1} 위와 같습니다')).toBe('{"a":1}');
  });

  it('JSON 값 안 임베디드 코드펜스 보존 (string-aware)', () => {
    const input = '{"code":"```py```"}';
    expect(stripMarkdownJson(input)).toBe(input);
  });

  it('잘린 배열 — 누락 close bracket 보충', () => {
    expect(stripMarkdownJson('[{"a":1},{"b":2}')).toBe('[{"a":1},{"b":2}]');
  });

  it('미닫힌 string — 닫는 따옴표 보충', () => {
    expect(stripMarkdownJson('{"a":"unfin')).toBe('{"a":"unfin"}');
  });

  it('trailing comma 제거 후 close brace 보충', () => {
    expect(stripMarkdownJson('[{"a":1},')).toBe('[{"a":1}]');
  });

  it('빈 문자열 — 그대로 반환', () => {
    expect(stripMarkdownJson('')).toBe('');
  });

  it('중첩 객체 잘림 — stack 기반 보충', () => {
    expect(stripMarkdownJson('{"a":{"b":1')).toBe('{"a":{"b":1}}');
  });

  it('JSON 시작점 없음 — 원본 trim 결과 반환 (best effort)', () => {
    const input = 'no JSON here at all';
    // 코드펜스 제거 + trim 만 수행
    expect(stripMarkdownJson(input)).toBe(input);
  });

  it('복구 후 결과는 JSON.parse 가능 (round-trip)', () => {
    const cases = [
      '[{"a":1},{"b":2}',
      '{"a":"unfin',
      '[{"a":1},',
      '{"a":{"b":1',
    ];
    for (const c of cases) {
      const repaired = stripMarkdownJson(c);
      expect(() => JSON.parse(repaired)).not.toThrow();
    }
  });

  it('이스케이프된 따옴표 안 brace 무시 (string-aware)', () => {
    const input = '{"a":"with \\"escaped\\" quote"}';
    expect(stripMarkdownJson(input)).toBe(input);
  });
});
