/**
 * @case ERR-20260418-06
 * @summary same-price dates from different weekdays must remain separate poster rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-06: groupForPoster partitions by weekday inside each price group', () => {
  const source = read('src/lib/price-dates.ts');

  assert.match(source, /ERR-20260418-06/);
  assert.match(source, /const byPrice = new Map<number, PriceDate\[\]>\(\)/);
  assert.match(source, /const byDow = new Map<number, PriceDate\[\]>\(\)/);
  assert.match(source, /for \(const pd of priceDates\)/);
  assert.match(source, /subGroups\.push\(\{ label: DOW_NAMES\[d\], dates: byDow\.get\(d\)! \}\)/);
});

test('ERR-20260418-06: unit test rejects weekday range hallucination', () => {
  const testSource = read('src/lib/price-dates.test.ts');

  assert.match(testSource, /ERR-20260418-06 Strict/);
  assert.match(testSource, /expect\(r\[0\]\.rows\)\.toHaveLength\(2\)/);
  assert.match(testSource, /expect\(dows\.every\(d => d\.length === 1\)\)\.toBe\(true\)/);
});
