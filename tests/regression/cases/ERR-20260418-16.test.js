/**
 * @case ERR-20260418-16
 * @summary single-month price table chunks must still render a month header row.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-16: price_dates mode always emits month header rows', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260418-16/);
  assert.match(source, /monthGroups\.map\(\(mg\) => \(/);
  assert.match(source, /<React\.Fragment key=\{mg\.month\}>/);
  assert.match(source, /<td colSpan=\{3 \+ \(hasChild \? 1 : 0\) \+ 1\}/);
  assert.match(source, /\{mg\.month\}/);
});

test('ERR-20260418-16: tier fallback mode also emits month header rows', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /\[\.\.\.monthGroups\.entries\(\)\]\.map\(\(\[month, rows\]\) => \(/);
  assert.match(source, /<React\.Fragment key=\{month\}>/);
  assert.match(source, /<td colSpan=\{3 \+ \(hasChild \? 1 : 0\) \+ 1\}/);
  assert.match(source, /\{month\}/);
});
