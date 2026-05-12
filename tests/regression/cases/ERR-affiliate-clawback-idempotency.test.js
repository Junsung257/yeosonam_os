/**
 * @case ERR-affiliate-clawback-idempotency (2026-04-26)
 * @summary 환불/취소 시 어필리에이터 커미션 자동 회수 + 멱등성.
 *
 *   - status 'confirmed' → 'refunded': 음수 commission_adjustments INSERT
 *   - 부분환불(refund_rate 0.3): 커미션 30% 회수
 *   - 이미 회수된 booking은 다시 트리거되어도 중복 INSERT 안 됨 (commission_clawed_back 플래그)
 *   - self-referral 예약은 회수 대상 아님 (이미 커미션 0)
 *   - 멱등성 키: 동일 idempotency_key 로 두 번 INSERT 시 두 번째는 차단되어야 함
 *
 * 회귀: SQL 트리거 로직(JS 모사) + idempotency 패턴 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── trigger_commission_clawback 의 핵심 결정 로직 (JS 모사) ──
function shouldClawback(oldRow, newRow) {
  if (newRow.commission_clawed_back) return null;            // 이미 처리됨
  if (!newRow.affiliate_id) return null;                      // 어필리에이터 없음
  if (!newRow.influencer_commission || newRow.influencer_commission === 0) return null;

  const statusChanged = oldRow.status !== newRow.status;
  if (!statusChanged) return null;
  if (!['refunded', 'cancelled'].includes(newRow.status)) return null;

  let refundPct;
  if (newRow.refund_rate != null) {
    refundPct = newRow.refund_rate;
  } else if (newRow.refund_amount != null && newRow.total_price > 0) {
    refundPct = newRow.refund_amount / newRow.total_price;
  } else {
    refundPct = 1.0;
  }
  refundPct = Math.max(0, Math.min(1, refundPct));

  const clawAmount = -Math.round(newRow.influencer_commission * refundPct);
  if (clawAmount >= 0) return null;

  return {
    type: newRow.status === 'refunded' ? 'clawback_refund' : 'clawback_dispute',
    amount: clawAmount,
    reason: `자동 회수: status ${oldRow.status} → ${newRow.status}, 환불율 ${refundPct}`,
  };
}

test('clawback: confirmed → refunded 전액 → 음수 -전액', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      total_price: 1000000,
      refund_rate: null,
      refund_amount: null,
      commission_clawed_back: false,
    },
  );
  assert.equal(r.amount, -50000);
  assert.equal(r.type, 'clawback_refund');
});

test('clawback: 부분환불 30% → 커미션 30% 회수', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      total_price: 1000000,
      refund_rate: 0.30,
      commission_clawed_back: false,
    },
  );
  assert.equal(r.amount, -15000); // 50000 * 0.3
});

test('clawback: refund_amount 만 있으면 비율 자동 계산', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 100000,
      total_price: 1000000,
      refund_amount: 500000, // 50%
      commission_clawed_back: false,
    },
  );
  assert.equal(r.amount, -50000);
});

test('멱등: commission_clawed_back=true 면 다시 트리거되어도 null', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      commission_clawed_back: true, // ← 이미 처리됨
    },
  );
  assert.equal(r, null);
});

test('clawback: cancelled 도 회수 대상', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'cancelled',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      total_price: 1000000,
      refund_rate: 1.0,
      commission_clawed_back: false,
    },
  );
  assert.equal(r.amount, -50000);
  assert.equal(r.type, 'clawback_dispute');
});

test('clawback: status 변경 없으면 트리거 안 됨', () => {
  const r = shouldClawback(
    { status: 'refunded' },  // 이미 refunded
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      commission_clawed_back: false,
    },
  );
  assert.equal(r, null);
});

test('clawback: affiliate_id 없으면 회수 안 함', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: null,
      influencer_commission: 50000,
      commission_clawed_back: false,
    },
  );
  assert.equal(r, null);
});

test('clawback: self-referral (commission=0) 회수 안 함', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 0,
      commission_clawed_back: false,
    },
  );
  assert.equal(r, null);
});

test('clawback: confirmed → completed 같은 정상 전환은 회수 안 함', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'completed',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      commission_clawed_back: false,
    },
  );
  assert.equal(r, null);
});

test('clawback: refund_rate 1.0 초과 입력은 1.0으로 클램프', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      total_price: 1000000,
      refund_rate: 1.5,  // 잘못된 값
      commission_clawed_back: false,
    },
  );
  assert.equal(r.amount, -50000); // max 100% 회수
});

test('clawback: refund_rate 음수는 0으로 클램프 → 회수 안 함', () => {
  const r = shouldClawback(
    { status: 'confirmed' },
    {
      status: 'refunded',
      affiliate_id: 'a1',
      influencer_commission: 50000,
      total_price: 1000000,
      refund_rate: -0.5,
      commission_clawed_back: false,
    },
  );
  // refund_rate=0 → claw_amount=0 → null
  assert.equal(r, null);
});

// ── idempotency_key 기반 중복 방어 ──
function processBookingInsert(payload, existingByKey) {
  if (payload.idempotency_key && existingByKey[payload.idempotency_key]) {
    return { ...existingByKey[payload.idempotency_key], idempotent_replay: true };
  }
  const newBooking = { ...payload, id: `bk_${Math.random().toString(36).slice(2, 8)}` };
  if (payload.idempotency_key) existingByKey[payload.idempotency_key] = newBooking;
  return newBooking;
}

test('idempotency: 같은 키 두 번째 호출은 기존 booking 반환', () => {
  const store = {};
  const a = processBookingInsert({ idempotency_key: 'key1', amount: 100 }, store);
  const b = processBookingInsert({ idempotency_key: 'key1', amount: 100 }, store);
  assert.equal(a.id, b.id);
  assert.equal(b.idempotent_replay, true);
});

test('idempotency: 다른 키는 새 booking 생성', () => {
  const store = {};
  const a = processBookingInsert({ idempotency_key: 'key1' }, store);
  const b = processBookingInsert({ idempotency_key: 'key2' }, store);
  assert.notEqual(a.id, b.id);
});

test('idempotency: 키 없으면 매번 새 booking', () => {
  const store = {};
  const a = processBookingInsert({ amount: 100 }, store);
  const b = processBookingInsert({ amount: 100 }, store);
  assert.notEqual(a.id, b.id);
  assert.equal(a.idempotent_replay, undefined);
});
