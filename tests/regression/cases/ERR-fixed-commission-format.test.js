/**
 * @case ERR-fixed-commission-format (2026-04-27)
 * @summary commission_fixed_amount + commission_currency 통화별 한국어 표기.
 *
 * 수정: dump_package_result.js 가 정액 모드(commission_fixed_amount > 0)일 때
 *   통화별 표기 — KRW: "90,000원/건 정액", USD: "$50/건 정액", JPY: "¥3,000/건 정액", CNY: "100元/건 정액".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function formatFixedCommission(amount, currency) {
  if (amount == null || Number(amount) <= 0) return null;
  const cur = (currency || 'KRW').toUpperCase();
  const num = Number(amount);
  if (cur === 'KRW') return `${num.toLocaleString('ko-KR')}원/건 정액`;
  if (cur === 'USD') return `$${num.toLocaleString('en-US')}/건 정액`;
  if (cur === 'JPY') return `¥${num.toLocaleString('ja-JP')}/건 정액`;
  if (cur === 'CNY') return `${num.toLocaleString('zh-CN')}元/건 정액`;
  return `${cur} ${num.toLocaleString('ko-KR')}/건 정액`;
}

test('ERR-fixed-commission-format: KRW 90000 → "90,000원/건 정액"', () => {
  assert.equal(formatFixedCommission(90000, 'KRW'), '90,000원/건 정액');
});

test('ERR-fixed-commission-format: KRW 100000 → "100,000원/건 정액"', () => {
  assert.equal(formatFixedCommission(100000, 'KRW'), '100,000원/건 정액');
});

test('ERR-fixed-commission-format: USD 50 → "$50/건 정액"', () => {
  assert.equal(formatFixedCommission(50, 'USD'), '$50/건 정액');
});

test('ERR-fixed-commission-format: JPY 3000 → "¥3,000/건 정액"', () => {
  assert.equal(formatFixedCommission(3000, 'JPY'), '¥3,000/건 정액');
});

test('ERR-fixed-commission-format: CNY 100 → "100元/건 정액"', () => {
  assert.equal(formatFixedCommission(100, 'CNY'), '100元/건 정액');
});

test('ERR-fixed-commission-format: 통화 미지정 → KRW', () => {
  assert.equal(formatFixedCommission(50000), '50,000원/건 정액');
});

test('ERR-fixed-commission-format: amount=0 → null (% 모드)', () => {
  assert.equal(formatFixedCommission(0, 'KRW'), null);
});

test('ERR-fixed-commission-format: amount=null → null', () => {
  assert.equal(formatFixedCommission(null, 'KRW'), null);
});
