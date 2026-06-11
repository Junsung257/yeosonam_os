/**
 * @case ERR-HET-price-table-desc-order
 * @summary price table rows inside each month must sort by date, not by price.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-price-table-desc-order: price-dates code documents date-first month ordering', () => {
  const source = read('src/lib/price-dates.ts');

  assert.match(source, /ERR-HET-price-table-desc-order/);
  assert.match(source, /rows\.sort/);
  assert.match(source, /a\.dates\[0\]\?\.day/);
  assert.match(source, /b\.dates\[0\]\?\.day/);
});

test('ERR-HET-price-table-desc-order: unit test locks ascending day order despite price changes', () => {
  const testSource = read('src/lib/price-dates.test.ts');

  assert.match(testSource, /ERR-HET-price-table-desc-order/);
  assert.match(testSource, /2026-08-26/);
  assert.match(testSource, /2026-08-05/);
  assert.match(testSource, /expect\(firstRow\.dates\[0\]\.day\)\.toBe\(5\)/);
});
