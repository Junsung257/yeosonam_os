/**
 * @case ERR-BHO-TB-04
 * @summary price-table parser must detect weekday/month OCR errors and suggest adjacent-month corrections.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { parsePriceRows } = require(path.join(ROOT, 'db/lib/parse-price-table.js'));

test('ERR-BHO-TB-04: 8/2,3,9,10,16 수목 is corrected to September 2026 dates', () => {
  const result = parsePriceRows([
    { label: '8/2,3,9,10,16 수목', prices: [869] },
  ], { year: 2026, priceUnit: 1000 });

  assert.ok(result.anomalies.length >= 1);
  assert.match(result.anomalies[0].issue, /요일 불일치/);
  assert.match(result.anomalies[0].suggestion, /9월로 교정 권장/);
  assert.deepEqual(
    result.rows.map((row) => row.date),
    ['2026-09-02', '2026-09-03', '2026-09-09', '2026-09-10', '2026-09-16'],
  );
});
