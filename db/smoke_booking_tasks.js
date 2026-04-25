/**
 * 여소남 OS — Booking Tasks Smoke Tests
 * =========================================================================
 * 프레임워크 의존 없이 Node 내장 node:test 로 실행.
 * DB 호출 없이 pure 로직만 검증.
 *
 * 실행:
 *   node --test db/smoke_booking_tasks.js
 *
 * 커버:
 *   1. fingerprint 결정성 (같은 입력 → 같은 해시)
 *   2. fingerprint salt 차별화
 *   3. helpers: calcBalance, calcMarginRate, isOverpaid, daysUntil
 *   4. Snooze preset ISO 변환
 *   5. Cooldown 경계 케이스
 *
 * 실제 DB 흐름(detect → INSERT → evaluateStale → auto_resolve)은
 * 배포 후 /api/admin/booking-tasks/run-now 를 force=true 로 호출해서 검증.
 */

const { test } = require('node:test');
const assert  = require('node:assert/strict');
const crypto  = require('crypto');

// ─── runner.ts 의 makeFingerprint 를 순수 JS 로 복제 (의존성 없이 검증) ────
function makeFingerprint(bookingId, taskType, now, salt) {
  const dateBucket = now.toISOString().slice(0, 10).replace(/-/g, '');
  const raw = [bookingId, taskType, salt ?? dateBucket].join('|');
  return crypto.createHash('md5').update(raw).digest('hex');
}

// ─── helpers.ts 복제 ──────────────────────────────────────────────────────
const FEE_TOLERANCE = 5000;

function calcBalance(totalPrice, paidAmount) {
  return Math.max(0, (totalPrice ?? 0) - (paidAmount ?? 0));
}
function calcMarginRate(totalPrice, totalCost) {
  if (!totalPrice || totalPrice <= 0) return null;
  return (totalPrice - (totalCost ?? 0)) / totalPrice;
}
function isOverpaid(totalPaidOut, totalCost) {
  if (!totalCost || totalCost <= 0) return false;
  return (totalPaidOut ?? 0) > totalCost + FEE_TOLERANCE;
}
function todayKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const today = new Date(todayKST(now) + 'T00:00:00Z').getTime();
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.round((d - today) / (24 * 60 * 60 * 1000));
}

// ─── types/booking-tasks.ts 의 snoozePresetIso 복제 ──────────────────────
function snoozePresetIso(hours, base = new Date()) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
}

// =========================================================================
// 1) Fingerprint
// =========================================================================
test('fingerprint: 같은 입력 같은 날짜 → 같은 해시 (멱등성 보장)', () => {
  const now = new Date('2026-04-23T12:00:00Z');
  const a = makeFingerprint('boo-1', 'unpaid_balance_d7', now);
  const b = makeFingerprint('boo-1', 'unpaid_balance_d7', now);
  assert.equal(a, b);
});

test('fingerprint: 같은 예약/룰이라도 다음날이면 다른 해시 (주기 허용)', () => {
  const day1 = new Date('2026-04-23T12:00:00Z');
  const day2 = new Date('2026-04-24T12:00:00Z');
  const a = makeFingerprint('boo-1', 'unpaid_balance_d7', day1);
  const b = makeFingerprint('boo-1', 'unpaid_balance_d7', day2);
  assert.notEqual(a, b);
});

test('fingerprint: salt 있으면 날짜 bucket 대신 salt 로 결정', () => {
  const day1 = new Date('2026-04-23T12:00:00Z');
  const day2 = new Date('2026-04-25T12:00:00Z');
  const a = makeFingerprint('boo-1', 'claim_keyword_reply', day1, 'msg-abc');
  const b = makeFingerprint('boo-1', 'claim_keyword_reply', day2, 'msg-abc');
  assert.equal(a, b, '같은 메시지 ID 면 날짜 상관없이 같은 fingerprint');
});

test('fingerprint: booking 다르면 해시 다름', () => {
  const now = new Date('2026-04-23T12:00:00Z');
  const a = makeFingerprint('boo-1', 'low_margin', now);
  const b = makeFingerprint('boo-2', 'low_margin', now);
  assert.notEqual(a, b);
});

// =========================================================================
// 2) helpers
// =========================================================================
test('calcBalance: 미수금 계산', () => {
  assert.equal(calcBalance(1_000_000, 500_000), 500_000);
  assert.equal(calcBalance(1_000_000, 1_000_000), 0);
  assert.equal(calcBalance(1_000_000, 1_500_000), 0, '음수는 0 으로 clamp');
  assert.equal(calcBalance(null, null), 0);
});

test('calcMarginRate: 마진율 계산', () => {
  assert.equal(calcMarginRate(1000, 900), 0.1);
  assert.equal(calcMarginRate(1000, 1100), -0.1, '음수 마진 허용 (low_margin 트리거)');
  assert.equal(calcMarginRate(0, 100), null, 'total_price=0 이면 null');
  assert.equal(calcMarginRate(null, 100), null);
});

test('isOverpaid: FEE_TOLERANCE 경계', () => {
  assert.equal(isOverpaid(1_005_000, 1_000_000), false, 'tolerance 이내');
  assert.equal(isOverpaid(1_005_001, 1_000_000), true,  'tolerance 1원 초과');
  assert.equal(isOverpaid(500_000, 0), false, 'total_cost 0 이면 판단 유보');
});

test('daysUntil: 기준일 대비 일수', () => {
  const now = new Date('2026-04-23T00:00:00+09:00');
  assert.equal(daysUntil('2026-04-23', now), 0, '오늘');
  assert.equal(daysUntil('2026-04-30', now), 7, '+7일');
  assert.equal(daysUntil('2026-04-20', now), -3, '과거');
  assert.equal(daysUntil(null, now), null);
});

// =========================================================================
// 3) Snooze preset
// =========================================================================
test('snoozePresetIso: +시간 ISO 변환', () => {
  const base = new Date('2026-04-23T00:00:00Z');
  const iso = snoozePresetIso(3, base);
  assert.equal(iso, '2026-04-23T03:00:00.000Z');
});

test('snoozePresetIso: +1주일', () => {
  const base = new Date('2026-04-23T00:00:00Z');
  const iso = snoozePresetIso(168, base);
  assert.equal(iso, '2026-04-30T00:00:00.000Z');
});

// =========================================================================
// 4) Cooldown 경계 (시뮬레이션)
// =========================================================================
test('cooldown: resolved_at 이 cooldown 기간 내면 skip 로직 통과', () => {
  const now = new Date('2026-04-23T12:00:00Z');
  const cooldownDays = 3;
  const since = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000);

  // 2일 전 resolved → cooldown 내 (skip 대상)
  const recent = new Date('2026-04-21T12:00:00Z');
  assert.equal(recent >= since, true);

  // 5일 전 resolved → cooldown 벗어남 (허용)
  const old = new Date('2026-04-18T12:00:00Z');
  assert.equal(old >= since, false);
});
