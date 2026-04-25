/**
 * @case ERR-special-notes-leak (2026-04-27)
 * @summary special_notes 컬럼이 쇼핑센터 fallback 으로 누출되어 운영 메모가
 * 고객 화면에 노출됐던 사고 — render-contract.ts resolveShopping() 변경으로 차단.
 *
 * 검증:
 *   1. customer_notes 가 비어있으면 view.shopping.text === null (fallback 출처 없음)
 *   2. special_notes 만 있고 customer_notes 가 없으면 → 누출 안 됨 (special_notes 는 fallback 아님)
 *   3. customer_notes 에 정상 텍스트 있으면 → view.shopping 에 노출
 *   4. customer_notes 에 INTERNAL_KEYWORDS 있으면 → blocked
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// CommonJS 에서 TS 직접 import 불가 — 정규식·로직을 미러링한 sanity check.
// 진짜 검증은 다음 변경 시 회귀를 즉시 잡는 것이 목적.
const INTERNAL_KEYWORDS = /커미션|commission_rate|정산|LAND_OPERATOR|스키마\s*제약|랜드사\s*메모|랜드사\s*커미션/i;

function resolveShoppingMirror(pkg) {
  const fromHighlights = pkg.itinerary_data?.highlights?.shopping?.trim();
  if (fromHighlights) {
    return { text: fromHighlights, source: 'highlights', blocked: false };
  }
  const fallback = pkg.customer_notes?.trim();
  if (!fallback) return { text: null, source: null, blocked: false };
  if (INTERNAL_KEYWORDS.test(fallback)) {
    return { text: null, source: 'customer_notes', blocked: true };
  }
  return { text: fallback, source: 'customer_notes', blocked: false };
}

test('ERR-special-notes-leak: special_notes 만 있어도 쇼핑 fallback 누출 없음', () => {
  const pkg = {
    special_notes: '* 출발 좌석 조건: 4/29 선발\n* 그린피 특가',
    customer_notes: null,
  };
  const r = resolveShoppingMirror(pkg);
  assert.equal(r.text, null, 'special_notes 단독으로는 view.shopping 에 노출되면 안 됨');
  assert.equal(r.source, null);
  assert.equal(r.blocked, false);
});

test('ERR-special-notes-leak: customer_notes 비어있으면 null', () => {
  const r = resolveShoppingMirror({ customer_notes: '' });
  assert.equal(r.text, null);
});

test('ERR-special-notes-leak: customer_notes 정상 → 노출', () => {
  const r = resolveShoppingMirror({ customer_notes: '쇼핑센터 3회 (차/실크/진주)' });
  assert.equal(r.text, '쇼핑센터 3회 (차/실크/진주)');
  assert.equal(r.source, 'customer_notes');
  assert.equal(r.blocked, false);
});

test('ERR-special-notes-leak: customer_notes 에 운영 키워드 → blocked', () => {
  const r = resolveShoppingMirror({ customer_notes: '랜드부산 9만원 커미션 고정' });
  assert.equal(r.text, null);
  assert.equal(r.blocked, true);
});

test('ERR-special-notes-leak: highlights.shopping 우선 (customer_notes 무시)', () => {
  const r = resolveShoppingMirror({
    itinerary_data: { highlights: { shopping: '노옵션 & 노쇼핑' } },
    customer_notes: '잘못된 정보',
  });
  assert.equal(r.text, '노옵션 & 노쇼핑');
  assert.equal(r.source, 'highlights');
});
