/**
 * @case ERR-20260417-04
 * @summary duplicate detection must not treat two empty price date sets as identical.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260417-04: empty price arrays are not a skip condition', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /function isSamePriceDates\(oldPkg, newPkg\)/);
  assert.match(source, /const oldPairs = toSortedPairs\(oldPkg\)/);
  assert.match(source, /const newPairs = toSortedPairs\(newPkg\)/);
  assert.match(source, /if \(!oldPairs\.length && !newPairs\.length\) return false/);
  assert.match(source, /if \(oldPairs\.length !== newPairs\.length\) return false/);
  assert.match(source, /if \(oldPairs\[i\]\.date !== newPairs\[i\]\.date\) return false/);
  assert.match(source, /if \(oldPairs\[i\]\.price !== newPairs\[i\]\.price\) return false/);
});

test('ERR-20260417-04: helper remains exported for direct regression tests', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /module\.exports = \{[\s\S]*isSamePriceDates[\s\S]*\}/);
});
