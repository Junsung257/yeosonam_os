/**
 * @case ERR-W21-internal-keywords (2026-04-27)
 * @summary W21 검증 — customer_notes / 고객 노출 필드에 운영 키워드(커미션·정산·랜드사 협의·마진 등)
 *   포함 시 INSERT 차단. ERR-FUK-customer-leaks 의 핵심 방어.
 *
 * 수정: insert-template.js validatePackage W21 + render-contract.ts INTERNAL_KEYWORDS 통합 정규식.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// FIELD_POLICY.md 와 동일한 패턴 (insert-template.js / render-contract.ts SSOT)
const INTERNAL_KEYWORDS_RE = /(?:커미션|정산|랜드사\s*협의|랜드사\s*마진|commission_rate|LAND_OPERATOR|마진\s*\d|매입가|원가|정액|네트가)/i;

function isLeaking(text) {
  if (!text || typeof text !== 'string') return false;
  return INTERNAL_KEYWORDS_RE.test(text);
}

test('ERR-W21-internal-keywords: "커미션 9%" → 누출', () => {
  assert.equal(isLeaking('커미션 9% 정산'), true);
});

test('ERR-W21-internal-keywords: "정산 후 송금" → 누출', () => {
  assert.equal(isLeaking('월말 정산 후 송금'), true);
});

test('ERR-W21-internal-keywords: "랜드사 협의 사항" → 누출', () => {
  assert.equal(isLeaking('랜드사 협의 사항: 단체 할인'), true);
});

test('ERR-W21-internal-keywords: "마진 9%" → 누출', () => {
  assert.equal(isLeaking('마진 9 적용'), true);
});

test('ERR-W21-internal-keywords: "commission_rate=0.09" → 누출', () => {
  assert.equal(isLeaking('commission_rate=0.09'), true);
});

test('ERR-W21-internal-keywords: "매입가 50만원" → 누출', () => {
  assert.equal(isLeaking('매입가 50만원'), true);
});

test('ERR-W21-internal-keywords: "정액 마진 9만원" → 누출', () => {
  assert.equal(isLeaking('정액 마진 9만원/건'), true);
});

test('ERR-W21-internal-keywords: 정상 고객 메모 → 통과', () => {
  assert.equal(isLeaking('출발 좌석 조건 4/29 발권'), false);
  assert.equal(isLeaking('일정 미참여 시 1인 $150 패널티'), false);
  assert.equal(isLeaking('여권 유효기간 6개월 이상'), false);
});

test('ERR-W21-internal-keywords: 빈 문자열 / null', () => {
  assert.equal(isLeaking(''), false);
  assert.equal(isLeaking(null), false);
  assert.equal(isLeaking(undefined), false);
});
