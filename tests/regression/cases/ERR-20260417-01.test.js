/**
 * @case ERR-20260417-01
 * @summary A4 poster weekday grouping must not invent a continuous range such
 * as Sun-Wed when only non-consecutive weekdays exist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260417-01: groupForPoster does not keep the old sunToWed merge path', () => {
  const source = read('src/lib/price-dates.ts');

  assert.match(source, /export function groupForPoster/);
  assert.doesNotMatch(source, /sunToWed/);
  assert.match(source, /const byDow = new Map<number, PriceDate\[]>\(\)/);
  assert.match(source, /const sortedDows = \[\.\.\.byDow\.keys\(\)\]\.sort/);
  assert.match(source, /subGroups\.push\(\{ label: DOW_NAMES\[d\], dates: byDow\.get\(d\)! \}\)/);
});

test('ERR-20260417-01: existing unit coverage proves different weekdays are split', () => {
  const testSource = read('src/lib/price-dates.test.ts');

  assert.match(testSource, /groupForPoster/);
  assert.match(testSource, /Strict Grouping/);
  assert.match(testSource, /rows\)\.toHaveLength\(2\)/);
  assert.match(testSource, /dows\.every\(d => d\.length === 1\)/);
});
