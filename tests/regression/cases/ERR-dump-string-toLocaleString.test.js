/**
 * @case ERR-dump-string-toLocaleString (2026-04-27)
 * @summary db/dump_package_result.js 가 single_supplement 가 string("평일 30,000원/박/인 · 금토 ...")
 *   일 때 toLocaleString() 호출 → string 그대로 반환 → "원" suffix 붙여 "...박/인" + "원" = "박/인원" 충돌.
 *
 * 수정: typeof 분기 — string 이면 그대로, number 면 toLocaleString + "원".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function formatSingleSupplement(ss) {
  if (ss == null || ss === '') return '0원';
  if (typeof ss === 'number') return `${ss.toLocaleString()}원`;
  return String(ss);
}

test('ERR-dump-string-toLocaleString: number → toLocaleString + 원', () => {
  assert.equal(formatSingleSupplement(30000), '30,000원');
});

test('ERR-dump-string-toLocaleString: string → 그대로', () => {
  assert.equal(formatSingleSupplement('평일 30,000원/박/인 · 금토 40,000원/박/인'), '평일 30,000원/박/인 · 금토 40,000원/박/인');
});

test('ERR-dump-string-toLocaleString: string 끝에 "원" 추가 안됨 (박/인원 방지)', () => {
  const result = formatSingleSupplement('30,000원/박/인');
  assert.equal(result.endsWith('박/인'), true);
  assert.equal(result.endsWith('박/인원'), false);
});

test('ERR-dump-string-toLocaleString: null → 0원', () => {
  assert.equal(formatSingleSupplement(null), '0원');
});

test('ERR-dump-string-toLocaleString: undefined → 0원', () => {
  assert.equal(formatSingleSupplement(undefined), '0원');
});

test('ERR-dump-string-toLocaleString: 빈 문자열 → 0원', () => {
  assert.equal(formatSingleSupplement(''), '0원');
});

test('ERR-dump-string-toLocaleString: 0 (number) → 0원', () => {
  assert.equal(formatSingleSupplement(0), '0원');
});
