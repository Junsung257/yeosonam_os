/**
 * @case ERR-LB-DAD-displayprice
 * @summary default package price display must use minPrice unless a date is explicitly selected.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-LB-DAD-displayprice: mobile detail keeps selected-date price behind explicit selection', () => {
  const source = read('src/app/packages/[id]/DetailClient.tsx');

  assert.match(source, /ERR-LB-DAD-displayprice/);
  assert.match(source, /const selectedDateInfo = selectedDate \? allPriceDates\.find/);
  assert.match(source, /selectedDateInfo\?\.price/);
  assert.match(source, /const minPrice = useMemo/);
  assert.match(source, /const displayPrice = selectedTier\?\.adult_price \?\? \(selectedDate \? selectedDateInfo\?\.price : null\) \?\? minPrice/);
});

test('ERR-LB-DAD-displayprice: price-date tests keep zero and negative prices out of min price', () => {
  const testSource = read('src/lib/price-dates.test.ts');

  assert.match(testSource, /ERR-LB-DAD-displayprice/);
  assert.match(testSource, /getMinPriceFromDates/);
  assert.match(testSource, /price: 0/);
  assert.match(testSource, /toBe\(1_500_000\)/);
});
