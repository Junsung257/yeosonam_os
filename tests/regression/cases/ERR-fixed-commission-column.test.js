/**
 * @case ERR-fixed-commission-column (2026-04-27)
 * @summary commission_rate (%) ↔ commission_fixed_amount (정액) 가 상호배타.
 *   createInserter 가 fixedAmount 받으면 rate 자동 0 으로, 동시 사용은 모순.
 *
 * 수정: createInserter signature — commissionFixedAmount 있으면 commissionRate 무시 + 0 으로 강제.
 *
 * 회귀: 정책 결정 함수를 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// insert-template.js createInserter 의 정책 추출
function resolveCommissionPolicy({ commissionRate, commissionFixedAmount, commissionCurrency }) {
  const fixed = commissionFixedAmount ?? null;
  const currency = commissionCurrency || 'KRW';
  // 정액 모드 활성: fixed 가 0보다 큰 숫자
  if (fixed != null && Number(fixed) > 0) {
    return {
      mode: 'fixed',
      commission_rate: 0,
      commission_fixed_amount: Number(fixed),
      commission_currency: currency,
    };
  }
  // % 모드
  return {
    mode: 'percent',
    commission_rate: commissionRate ?? 0,
    commission_fixed_amount: null,
    commission_currency: currency,
  };
}

test('ERR-fixed-commission-column: 정액 90000 + rate 9 → 정액 우선, rate=0 강제', () => {
  const r = resolveCommissionPolicy({ commissionRate: 9, commissionFixedAmount: 90000, commissionCurrency: 'KRW' });
  assert.equal(r.mode, 'fixed');
  assert.equal(r.commission_rate, 0);
  assert.equal(r.commission_fixed_amount, 90000);
});

test('ERR-fixed-commission-column: rate 9 만 → percent 모드', () => {
  const r = resolveCommissionPolicy({ commissionRate: 9 });
  assert.equal(r.mode, 'percent');
  assert.equal(r.commission_rate, 9);
  assert.equal(r.commission_fixed_amount, null);
});

test('ERR-fixed-commission-column: 정액 100000 USD → currency 보존', () => {
  const r = resolveCommissionPolicy({ commissionFixedAmount: 100, commissionCurrency: 'USD' });
  assert.equal(r.mode, 'fixed');
  assert.equal(r.commission_currency, 'USD');
});

test('ERR-fixed-commission-column: fixedAmount=0 → percent 모드 (정액 비활성)', () => {
  const r = resolveCommissionPolicy({ commissionRate: 9, commissionFixedAmount: 0 });
  assert.equal(r.mode, 'percent');
  assert.equal(r.commission_rate, 9);
});

test('ERR-fixed-commission-column: fixedAmount=null + rate 미지정 → 0%', () => {
  const r = resolveCommissionPolicy({});
  assert.equal(r.mode, 'percent');
  assert.equal(r.commission_rate, 0);
});

test('ERR-fixed-commission-column: 정액 모드는 절대 commission_rate>0 안 됨 (상호배타)', () => {
  for (const fixed of [50000, 90000, 100000, 200000]) {
    const r = resolveCommissionPolicy({ commissionRate: 15, commissionFixedAmount: fixed });
    assert.equal(r.commission_rate, 0, `fixed=${fixed} 인데 rate=${r.commission_rate}`);
  }
});

test('ERR-fixed-commission-column: currency 미지정 → KRW 기본값', () => {
  const r = resolveCommissionPolicy({ commissionFixedAmount: 50000 });
  assert.equal(r.commission_currency, 'KRW');
});

test('ERR-fixed-commission-column: 정액 음수는 무시되어 percent 모드', () => {
  const r = resolveCommissionPolicy({ commissionRate: 5, commissionFixedAmount: -100 });
  assert.equal(r.mode, 'percent');
  assert.equal(r.commission_rate, 5);
});
