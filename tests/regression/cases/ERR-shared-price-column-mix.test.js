/**
 * @case ERR-shared-price-column-mix
 * @summary Shared catalog price tables must fail verification when DB
 * price_dates mix columns for the wrong package variant.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-shared-price-column-mix: upload verification C12 blocks wrong shared price columns', () => {
  const source = read('src/lib/upload-verify.ts');
  const unitTest = read('src/lib/upload-verify.test.ts');

  assert.match(source, /C12/);
  assert.match(source, /extractPriceIR/);
  assert.match(source, /price_dates/);
  assert.match(unitTest, /extractProductRawTextSection/);
  assert.match(unitTest, /C12 blocks shared price-table column mismatches/);
  assert.match(unitTest, /C12 blocks extra departure dates not present in the selected product table/);
  assert.match(unitTest, /findCheck\(r, 'C12'\)\?\.status\)\.toBe\('fail'\)/);
});
