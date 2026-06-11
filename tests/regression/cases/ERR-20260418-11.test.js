/**
 * @case ERR-20260418-11
 * @summary A4 price tables must be chunked by row budget instead of being
 * forced into page 1 where overflow hidden clips rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-11: A4 price table has separate row budgets for first and later pages', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260418-11\/12/);
  assert.match(source, /const PRICE_ROWS_PAGE1 = 18/);
  assert.match(source, /const PRICE_ROWS_OTHER = 24/);
  assert.match(source, /const priceChunks: PriceChunkFilter\[\]\[\] = \[\[\]\]/);
  assert.match(source, /const limit = isFirst \? PRICE_ROWS_PAGE1 : PRICE_ROWS_OTHER/);
});

test('ERR-20260418-11: oversized month groups are split by price as fallback', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /if \(groupRows > PRICE_ROWS_OTHER\) \{/);
  assert.match(source, /const uniquePrices = new Set\(g\.rows\.map\(r => r\.price\)\)/);
  assert.match(source, /const priceRows = g\.rows\.filter\(r => r\.price === price\)\.length/);
  assert.match(source, /pushToCurrentOrNew\(\{ month: monthNum, prices: new Set\(\[price\]\) \}/);
  assert.match(source, /extraChunks\.map\(\(chunk, idx\) => \(/);
});
