/**
 * @case ERR-calendar-month-discoverability (2026-04-27)
 * @summary DepartureCalendar 가 첫 출발월만 표시 → 다음 달에 더 많은 출발일 있어도 인지 불가.
 *   캐슬렉스 케이스(5월 3건 + 6월 6건)에서 5월만 보고 6월 모름.
 *
 * 수정: availableMonths 집계 로직 추가 — 오늘 이후 + price>0 만 카운트, 2개월 이상일 때 chip 표시.
 *
 * 회귀: availableMonths 집계 로직을 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// DepartureCalendar.tsx availableMonths 와 동일한 로직
function computeAvailableMonths(priceDates, today) {
  const dateMap = new Map();
  (priceDates || []).forEach(d => { if (d?.date) dateMap.set(d.date, d); });
  const buckets = new Map();
  for (const [ymd, pd] of dateMap.entries()) {
    if (ymd < today) continue;
    if (!pd || pd.price <= 0) continue;
    const ym = ymd.slice(0, 7);
    buckets.set(ym, (buckets.get(ym) || 0) + 1);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
}

test('ERR-calendar-month-discoverability: 5월 3건 + 6월 6건 → [["2026-05",3], ["2026-06",6]]', () => {
  const dates = [
    ...['2026-05-13', '2026-05-26', '2026-05-27'].map(d => ({ date: d, price: 579000 })),
    ...['2026-06-02', '2026-06-16', '2026-06-17', '2026-06-22', '2026-06-29', '2026-06-30'].map(d => ({ date: d, price: 579000 })),
  ];
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.deepEqual(r, [['2026-05', 3], ['2026-06', 6]]);
});

test('ERR-calendar-month-discoverability: 과거 출발일 제외', () => {
  const dates = [
    { date: '2026-03-01', price: 500000 },  // 과거
    { date: '2026-05-01', price: 500000 },
  ];
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.deepEqual(r, [['2026-05', 1]]);
});

test('ERR-calendar-month-discoverability: price=0 제외 (제외일)', () => {
  const dates = [
    { date: '2026-05-01', price: 0 },
    { date: '2026-05-02', price: 500000 },
  ];
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.deepEqual(r, [['2026-05', 1]]);
});

test('ERR-calendar-month-discoverability: 단일 월만 → 1개 항목 (chip 표시 안됨, 컴포넌트가 length>=2 가드)', () => {
  const dates = [{ date: '2026-05-01', price: 500000 }];
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.equal(r.length, 1);
});

test('ERR-calendar-month-discoverability: 정렬 오름차순', () => {
  const dates = [
    { date: '2026-08-01', price: 500000 },
    { date: '2026-05-01', price: 500000 },
    { date: '2026-06-01', price: 500000 },
  ];
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.deepEqual(r.map(([ym]) => ym), ['2026-05', '2026-06', '2026-08']);
});

test('ERR-calendar-month-discoverability: 빈 priceDates → 빈 배열', () => {
  assert.deepEqual(computeAvailableMonths([], '2026-04-25'), []);
  assert.deepEqual(computeAvailableMonths(null, '2026-04-25'), []);
  assert.deepEqual(computeAvailableMonths(undefined, '2026-04-25'), []);
});

test('ERR-calendar-month-discoverability: 같은 월 여러 날 합산', () => {
  const dates = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    price: 500000,
  }));
  const r = computeAvailableMonths(dates, '2026-04-25');
  assert.deepEqual(r, [['2026-05', 10]]);
});
