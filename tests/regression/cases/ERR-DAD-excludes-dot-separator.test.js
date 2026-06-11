/**
 * @case ERR-DAD-excludes-dot-separator
 * @summary DAD excludes must preserve source comma separators inside a single field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-DAD-excludes-dot-separator: archived DAD script keeps excludes as source-backed array values', () => {
  const source = read('db/_archive/insert_landbusan_dad_20260420_packages.js');

  assert.match(source, /const EXCLUDES = \[/);
  assert.match(source, /excludes: EXCLUDES/);
  assert.match(source, /highlights: \{/);
  assert.match(source, /excludes: EXCLUDES/);
  assert.equal(source.includes('마사지팁 60분 $2·90분 $3·120분 $4'), false);
});
