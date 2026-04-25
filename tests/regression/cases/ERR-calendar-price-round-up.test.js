/**
 * @case ERR-calendar-price-round-up (2026-04-27)
 * @summary DepartureCalendar 가 가격을 Math.round 로 표기해 579,000원이 "58만" 으로
 * 부풀려져 신뢰 손상. floor + 1자리 정밀도 표기로 수정.
 *
 * 검증:
 *   1. 579,000 → "57.9만" (반올림 금지, 1자리 floor)
 *   2. 600,000 → "60만" (정수면 .0 생략)
 *   3. 599,000 → "59.9만"
 *   4. 1,259,000 → "125.9만"
 *   5. 0 → '' (빈 문자열)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function calendarPriceLabel(price) {
  if (!(price > 0)) return '';
  const v = price / 10000;
  const s = (Math.floor(v * 10) / 10).toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}만`;
}

test('ERR-calendar-price-round-up: 579,000 → "57.9만" (반올림 금지)', () => {
  const r = calendarPriceLabel(579000);
  assert.equal(r, '57.9만');
  assert.notEqual(r, '58만', '반올림 표기 금지 — 가격 부풀림 방지');
});

test('ERR-calendar-price-round-up: 600,000 → "60만" (정수면 .0 생략)', () => {
  assert.equal(calendarPriceLabel(600000), '60만');
});

test('ERR-calendar-price-round-up: 599,000 → "59.9만"', () => {
  assert.equal(calendarPriceLabel(599000), '59.9만');
});

test('ERR-calendar-price-round-up: 1,259,000 → "125.9만"', () => {
  assert.equal(calendarPriceLabel(1259000), '125.9만');
});

test('ERR-calendar-price-round-up: 679,000 → "67.9만" (캐슬렉스 4일 케이스)', () => {
  assert.equal(calendarPriceLabel(679000), '67.9만');
});

test('ERR-calendar-price-round-up: 0 → ""', () => {
  assert.equal(calendarPriceLabel(0), '');
});

test('ERR-calendar-price-round-up: 음수/null → ""', () => {
  assert.equal(calendarPriceLabel(-100), '');
  assert.equal(calendarPriceLabel(null), '');
  assert.equal(calendarPriceLabel(undefined), '');
});
