/**
 * @case ERR-isr-revalidate-manual (2026-04-27)
 * @summary DB 직접 수정 후 모바일 production ISR 캐시 1시간 stale.
 *   `_revalidate.js` 헬퍼가 REVALIDATE_SECRET placeholder("아무_문자열_32자_이상") 감지 시
 *   호출 자체를 건너뛰지 않으면 매번 401/403 에러.
 *
 * 수정: isPlaceholder() 검출 — 한글/공백 포함 OR 길이<16.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// _revalidate.js 의 isPlaceholder 와 동일
function isPlaceholder(secret) {
  if (!secret) return true;
  if (/[가-힣\s]/.test(secret)) return true;
  if (secret.length < 16) return true;
  return false;
}

test('ERR-isr-revalidate-manual: null/undefined → placeholder', () => {
  assert.equal(isPlaceholder(null), true);
  assert.equal(isPlaceholder(undefined), true);
  assert.equal(isPlaceholder(''), true);
});

test('ERR-isr-revalidate-manual: 한글 placeholder → placeholder', () => {
  assert.equal(isPlaceholder('아무_문자열_32자_이상'), true);
});

test('ERR-isr-revalidate-manual: 공백 포함 → placeholder', () => {
  assert.equal(isPlaceholder('my secret 123'), true);
});

test('ERR-isr-revalidate-manual: 길이 16 미만 → placeholder', () => {
  assert.equal(isPlaceholder('short_key'), true);
  assert.equal(isPlaceholder('123456789012345'), true);  // 15자
});

test('ERR-isr-revalidate-manual: 정상 시크릿 (16자 이상 + 영숫자) → 통과', () => {
  assert.equal(isPlaceholder('a1b2c3d4e5f6g7h8'), false);  // 16자
  assert.equal(isPlaceholder('xK9mP3qN8vR2tL5wQ7yH'), false);
});

test('ERR-isr-revalidate-manual: hex 시크릿 → 통과', () => {
  assert.equal(isPlaceholder('abcdef0123456789abcdef0123456789'), false);
});

test('ERR-isr-revalidate-manual: 한글 1글자라도 → placeholder', () => {
  assert.equal(isPlaceholder('SecretKey한글ABCDEF'), true);
});
