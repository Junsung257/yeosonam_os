/**
 * @case ERR-LB-DAD-cancel-14day
 * @summary cancellation-date formatting must handle range expressions such as 14일 ~ 7일 전.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-LB-DAD-cancel-14day: implementation enriches cancellation ranges before single-day terms', () => {
  const source = read('src/lib/standard-terms.ts');

  assert.match(source, /const withRangeDates = n\.text\.replace/);
  assert.match(source, /\(\\d\+\)일\\s\*~\\s\*\(\\d\+\)일\\s\*전/);
  assert.match(source, /fromTarget\.setDate\(fromTarget\.getDate\(\) - fromDays\)/);
  assert.match(source, /toTarget\.setDate\(toTarget\.getDate\(\) - toDays\)/);
  assert.match(source, /withRangeDates\.replace/);
  assert.match(source, /\\d\{4\}\\\.\\d\{2\}\\\.\\d\{2\}까지/);
});

test('ERR-LB-DAD-cancel-14day: unit test pins both endpoints and duplicate-date protection', () => {
  const source = read('src/lib/standard-terms.test.ts');

  assert.match(source, /ERR-LB-DAD-cancel-14day/);
  assert.match(source, /14일 ~ 7일 전/);
  assert.match(source, /14일\(2026\.06\.16까지\) ~ 7일전\(2026\.06\.23까지\)/);
  assert.match(source, /not\.toMatch\(\/2026\\\.06\\\.23까지/);
});
