/**
 * @case ERR-DAD-highlights-inclusions-hardcode
 * @summary itinerary highlights must reuse the top-level inclusions/excludes arrays instead of drifting hard-coded copies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-DAD-highlights-inclusions-hardcode: DAD script wires itinerary highlights to shared inclusions/excludes constants', () => {
  const source = read('db/_archive/insert_landbusan_dad_20260420_packages.js');

  assert.match(source, /const INCLUSIONS = \[/);
  assert.match(source, /const EXCLUDES = \[/);
  assert.match(source, /inclusions: INCLUSIONS/);
  assert.match(source, /excludes: EXCLUDES/);
  assert.match(source, /highlights: \{\s*inclusions: INCLUSIONS,\s*excludes: EXCLUDES/s);
});
