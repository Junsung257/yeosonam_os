/**
 * @case ERR-20260418-12
 * @summary price table chunking must adapt to long month/price sets without cutting rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-12: A4 price table uses adaptive chunk filters', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260418-11\/12/);
  assert.match(source, /type PriceChunkFilter = \{ month: number; prices: Set<number> \| null \}/);
  assert.match(source, /const priceChunks: PriceChunkFilter\[\]\[\] = \[\[\]\]/);
  assert.match(source, /const pushToCurrentOrNew = \(filter: PriceChunkFilter, rowsToAdd: number/);
  assert.match(source, /currentRowsRef\.v \+ rowsToAdd > limit/);
  assert.match(source, /priceChunks\.push\(\[filter\]\)/);
});

test('ERR-20260418-12: oversized single months are split by price filters', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /if \(groupRows > PRICE_ROWS_OTHER\)/);
  assert.match(source, /const uniquePrices = new Set\(g\.rows\.map\(r => r\.price\)\)/);
  assert.match(source, /const priceRows = g\.rows\.filter\(r => r\.price === price\)\.length/);
  assert.match(source, /pushToCurrentOrNew\(\{ month: monthNum, prices: new Set\(\[price\]\) \}/);
  assert.match(source, /return chunk\.some\(c => c\.month === m && \(c\.prices === null \|\| c\.prices\.has\(d\.price\)\)\)/);
});
