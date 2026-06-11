/**
 * @case ERR-unmatched-limit-200
 * @summary unmatched activity admin API must page beyond the old hard-coded 200-row limit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-unmatched-limit-200: API uses 1000-row range pagination', () => {
  const source = read('src/app/api/unmatched/route.ts');

  assert.match(source, /ERR-unmatched-limit-200/);
  assert.match(source, /const PAGE = 1000/);
  assert.match(source, /for \(let from = 0; from < 100000; from \+= PAGE\)/);
  assert.match(source, /\.range\(from, from \+ PAGE - 1\)/);
  assert.match(source, /allItems\.push\(\.\.\.data\)/);
  assert.match(source, /if \(data\.length < PAGE\) break/);
});
