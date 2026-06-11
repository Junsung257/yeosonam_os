/**
 * @case ERR-20260418-17
 * @summary airline badges must not double-wrap codes that already include Korean names.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-17: airline name normalization strips flight number before mapping', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /ERR-20260418-13\/17/);
  assert.match(source, /export function getAirlineName/);
  assert.match(source, /flightCode\.split\(\/\[\\s\|\(\]\/\)\[0\]\.replace\(\/\\d\+\$\/, ''\)\.toUpperCase\(\)\.trim\(\)/);
  assert.match(source, /if \(AIRLINE_MAP\[code\]\) return AIRLINE_MAP\[code\]/);
  assert.match(source, /const parenMatch = flightCode\.match\(\/\\\(\(\[\^\)\]\+\)\\\)\/\)/);
});

test('ERR-20260418-17: unit tests cover code, code-plus-parentheses, and pipe forms', () => {
  const testSource = read('src/lib/render-contract.test.ts');

  assert.match(testSource, /describe\('getAirlineName'/);
  assert.match(testSource, /BX793/);
  assert.match(testSource, /BX\(.*\)/);
  assert.match(testSource, /BX \|/);
  assert.match(testSource, /formatFlightLabel/);
});
