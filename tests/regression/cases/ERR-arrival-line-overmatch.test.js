/**
 * @case ERR-arrival-line-overmatch (2026-04-27)
 * @summary DetailClient.tsx schedule 렌더 가드의 `/공항 도착/` 정규식이
 *   "청도공항 도착 후 가이드 미팅" 같이 도착 뒤에 추가 활동 있는 행까지 잡아
 *   `return null` 처리 → 가이드 미팅 정보 누락.
 *
 * 수정: anchored regex `/^[가-힣\s]*공항\s*도착\s*$/` — 텍스트가 정확히 "X공항 도착" 으로
 *   끝나는 경우만 skip, "도착 후 ..." / "도착 - ..." 같은 추가 활동은 보존.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// DetailClient.tsx 의 isSimpleArrival 가드와 동일 패턴
const SIMPLE_ARRIVAL_RE = /^[가-힣\s]*공항\s*도착\s*$/;
const isSimpleArrival = (act) => SIMPLE_ARRIVAL_RE.test((act || '').trim());

test('ERR-arrival-line-overmatch: "청도공항 도착" → skip', () => {
  assert.equal(isSimpleArrival('청도공항 도착'), true);
});

test('ERR-arrival-line-overmatch: "청도공항  도착" (다중 공백) → skip', () => {
  assert.equal(isSimpleArrival('청도공항  도착'), true);
});

test('ERR-arrival-line-overmatch: "청도공항 도착 후 가이드 미팅" → 보존', () => {
  assert.equal(isSimpleArrival('청도공항 도착 후 가이드 미팅'), false);
});

test('ERR-arrival-line-overmatch: "청도공항 도착 - 가이드 미팅" → 보존', () => {
  assert.equal(isSimpleArrival('청도공항 도착 - 가이드 미팅'), false);
});

test('ERR-arrival-line-overmatch: 청도공항 도착후 가이드미팅 (붙여쓰기) → 보존', () => {
  assert.equal(isSimpleArrival('청도공항 도착후 가이드미팅'), false);
});

test('ERR-arrival-line-overmatch: "출발" 라인은 무관 → skip 아님', () => {
  assert.equal(isSimpleArrival('김해국제공항 출발'), false);
});

test('ERR-arrival-line-overmatch: 빈 문자열', () => {
  assert.equal(isSimpleArrival(''), false);
  assert.equal(isSimpleArrival(null), false);
  assert.equal(isSimpleArrival(undefined), false);
});
