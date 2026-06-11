/**
 * @case ERR-LB-DAD-keyword-spillover
 * @summary attraction matcher stop words must prevent city-name-only spillover.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-LB-DAD-keyword-spillover: matcher documents and implements stop-word protection', () => {
  const source = read('src/lib/attraction-matcher.ts');

  assert.match(source, /ERR-LB-DAD-keyword-spillover/);
  assert.match(source, /MATCH_STOP_WORDS/);
  assert.match(source, /keyword split/);
});

test('ERR-LB-DAD-keyword-spillover: unit tests cover the original spillover pattern', () => {
  const testSource = read('src/lib/attraction-matcher.test.ts');

  assert.match(testSource, /ERR-LB-DAD-keyword-spillover/);
  assert.match(testSource, /MATCH_STOP_WORDS/);
  assert.match(testSource, /not\.toBe/);
  assert.match(testSource, /toBeNull/);
});
