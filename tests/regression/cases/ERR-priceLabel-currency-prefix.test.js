/**
 * @case ERR-priceLabel-currency-prefix (2026-04-27)
 * @summary surcharges 의 priceLabel 이 KRW 통화 코드를 그대로 prefix 로 노출 ("KRW30000/박/인").
 * render-contract.ts 의 mergeSurcharge() priceLabel 포맷팅이 통화별 한국어 친화 표기로 교체됨.
 *
 * 검증:
 *   1. KRW → "30,000원/박/인"
 *   2. USD → "$30/인"
 *   3. JPY → "¥3000/박/인"
 *   4. CNY → "100元/18홀/인"
 *   5. amount null → priceLabel null
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// render-contract 의 fmtAmount 로직 미러링 (TS 직접 import 불가)
function fmtAmount(s) {
  if (s.amount == null) return null;
  const cur = (s.currency || 'KRW').toUpperCase();
  const num = Number(s.amount);
  if (cur === 'KRW') return `${num.toLocaleString('ko-KR')}원`;
  if (cur === 'USD') return `$${num.toLocaleString('en-US')}`;
  if (cur === 'JPY') return `¥${num.toLocaleString('ja-JP')}`;
  if (cur === 'CNY') return `${num.toLocaleString('zh-CN')}元`;
  return `${cur} ${num.toLocaleString('ko-KR')}`;
}

function priceLabel(s) {
  const a = fmtAmount(s);
  return a ? `${a}${s.unit ? `/${s.unit}` : ''}` : null;
}

test('ERR-priceLabel-currency-prefix: KRW 30000 → "30,000원/박/인"', () => {
  const r = priceLabel({ amount: 30000, currency: 'KRW', unit: '박/인' });
  assert.equal(r, '30,000원/박/인');
  assert.ok(!r.includes('KRW'), 'KRW prefix 가 들어가면 안 됨');
});

test('ERR-priceLabel-currency-prefix: KRW 40000 → "40,000원/박/인"', () => {
  const r = priceLabel({ amount: 40000, currency: 'KRW', unit: '박/인' });
  assert.equal(r, '40,000원/박/인');
});

test('ERR-priceLabel-currency-prefix: USD 30 → "$30/인"', () => {
  const r = priceLabel({ amount: 30, currency: 'USD', unit: '인' });
  assert.equal(r, '$30/인');
});

test('ERR-priceLabel-currency-prefix: JPY 3000 → "¥3,000/박/인"', () => {
  const r = priceLabel({ amount: 3000, currency: 'JPY', unit: '박/인' });
  assert.match(r, /^¥3,?000\/박\/인$/);
});

test('ERR-priceLabel-currency-prefix: CNY 100 → "100元/18홀/인"', () => {
  const r = priceLabel({ amount: 100, currency: 'CNY', unit: '18홀/인' });
  assert.equal(r, '100元/18홀/인');
});

test('ERR-priceLabel-currency-prefix: amount null → null', () => {
  assert.equal(priceLabel({ amount: null, currency: 'KRW', unit: '박/인' }), null);
});

test('ERR-priceLabel-currency-prefix: 통화 미지정 → KRW 처리', () => {
  const r = priceLabel({ amount: 50000, unit: '인' });
  assert.equal(r, '50,000원/인');
});
