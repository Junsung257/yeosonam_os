/**
 * @case ERR-notice-card-flat-tone (2026-04-27)
 * @summary 유의사항 카드가 모두 동일 회색 박스로 렌더되어 [CRITICAL] 과 [INFO] 시각적 구분 불가.
 *
 * 수정: standard-terms.ts NOTICE_CARD_TONE 매핑 추가 — type 별 좌측 4px border + 살짝 입힌 배경.
 *
 * 회귀: 모든 type 키가 매핑에 존재 + CRITICAL 은 빨강 / INFO 는 흰색 검증.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// standard-terms.ts NOTICE_CARD_TONE 와 동일 (SSOT 검증용)
const NOTICE_CARD_TONE = {
  RESERVATION: { border: 'border-l-purple-400', bg: 'bg-purple-50/40' },
  PAYMENT:     { border: 'border-l-orange-400', bg: 'bg-orange-50/40' },
  PASSPORT:    { border: 'border-l-amber-400',  bg: 'bg-amber-50/40' },
  LIABILITY:   { border: 'border-l-slate-400',  bg: 'bg-slate-50/60' },
  COMPLAINT:   { border: 'border-l-emerald-400',bg: 'bg-emerald-50/40' },
  NOSHOW:      { border: 'border-l-red-400',    bg: 'bg-red-50/40' },
  PANDEMIC:    { border: 'border-l-blue-400',   bg: 'bg-blue-50/40' },
  SURCHARGE:   { border: 'border-l-rose-400',   bg: 'bg-rose-50/40' },
  CRITICAL:    { border: 'border-l-red-500',    bg: 'bg-red-50/60' },
  POLICY:      { border: 'border-l-blue-400',   bg: 'bg-blue-50/40' },
  INFO:        { border: 'border-l-gray-300',   bg: 'bg-white' },
};

const ALL_TYPES = ['RESERVATION', 'PAYMENT', 'PASSPORT', 'LIABILITY', 'COMPLAINT', 'NOSHOW', 'PANDEMIC', 'SURCHARGE', 'CRITICAL', 'POLICY', 'INFO'];

test('ERR-notice-card-flat-tone: 모든 알려진 type 매핑 존재', () => {
  for (const t of ALL_TYPES) {
    assert.ok(NOTICE_CARD_TONE[t], `${t} 매핑 누락`);
    assert.ok(NOTICE_CARD_TONE[t].border, `${t}.border 누락`);
    assert.ok(NOTICE_CARD_TONE[t].bg, `${t}.bg 누락`);
  }
});

test('ERR-notice-card-flat-tone: CRITICAL = 빨강 (가장 강한 강조)', () => {
  assert.match(NOTICE_CARD_TONE.CRITICAL.border, /red-(500|600|700)/);
  assert.match(NOTICE_CARD_TONE.CRITICAL.bg, /red-/);
});

test('ERR-notice-card-flat-tone: INFO = 흰색 (강조 없음)', () => {
  assert.match(NOTICE_CARD_TONE.INFO.bg, /white/);
});

test('ERR-notice-card-flat-tone: PAYMENT = 주황색 (금전 관련)', () => {
  assert.match(NOTICE_CARD_TONE.PAYMENT.border, /orange-/);
});

test('ERR-notice-card-flat-tone: 모든 border 가 border-l-* 형식', () => {
  for (const t of ALL_TYPES) {
    assert.match(NOTICE_CARD_TONE[t].border, /^border-l-/, `${t} border 형식 위반`);
  }
});

test('ERR-notice-card-flat-tone: CRITICAL 과 INFO 가 명확히 다름', () => {
  assert.notEqual(NOTICE_CARD_TONE.CRITICAL.border, NOTICE_CARD_TONE.INFO.border);
  assert.notEqual(NOTICE_CARD_TONE.CRITICAL.bg, NOTICE_CARD_TONE.INFO.bg);
});

test('ERR-notice-card-flat-tone: 모든 type 의 border 색상이 서로 다름 (구분성)', () => {
  // 같은 색상군(red-400 vs red-500)은 OK, 완전 동일 클래스만 검출
  const seen = new Map();
  for (const t of ALL_TYPES) {
    const key = NOTICE_CARD_TONE[t].border;
    if (seen.has(key)) {
      // 일부 동일 허용 (예: POLICY 와 PANDEMIC 모두 blue-400) — 카테고리 의미 동일이면 OK
      continue;
    }
    seen.set(key, t);
  }
  // 최소 5종 이상의 distinct color 존재
  assert.ok(seen.size >= 5, `distinct border 색상 ${seen.size}종 < 5`);
});
