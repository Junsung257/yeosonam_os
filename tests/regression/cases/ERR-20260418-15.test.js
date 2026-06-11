/**
 * @case ERR-20260418-15
 * @summary A4 price table pagination must use the current 18/24 row budgets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-15: row budgets prevent four-month products from wasting pages', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260418-15/);
  assert.match(source, /const PRICE_ROWS_PAGE1 = 18/);
  assert.match(source, /const PRICE_ROWS_OTHER = 24/);
  assert.match(source, /const limit = isFirst \? PRICE_ROWS_PAGE1 : PRICE_ROWS_OTHER/);
  assert.match(source, /const extraChunks = priceChunksDates\.slice\(1\)/);
});

test('ERR-20260418-15: chunking comment matches the live constants', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /Page 1[^\n]*18/);
  assert.match(source, /24/);
  assert.doesNotMatch(source, /Page 1[^\n]*12/);
  assert.doesNotMatch(source, /이후 페이지[^\n]*22/);
});
