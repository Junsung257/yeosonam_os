/**
 * @case ERR-20260418-14
 * @summary surcharge objects and exclude-string surcharges must be merged without dropping guide fees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-14: render contract preserves structured surcharge objects', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /ERR-20260418-14\/18/);
  assert.match(source, /const objects = pkg\.surcharges \?\? \[\]/);
  assert.match(source, /const classified = excludes\.length > 0[\s\S]*classifyExcludes\(excludes\)/);
  assert.match(source, /const fromObjects = objects\.map\(formatSurchargeObject\)/);
  assert.match(source, /const hasObjects = fromObjects\.length > 0/);
});

test('ERR-20260418-14: only bare duplicate surcharge lines are filtered', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /const remainingSurchargeLines = classified\.surcharges\.filter\(/);
  assert.match(source, /s => !\(hasObjects && isBareSurcharge\(s\)\)/);
  assert.match(source, /const fromExcludesMerged: MergedSurcharge\[\] = remainingSurchargeLines\.map\(raw =>/);
  assert.match(source, /merged: \[\.\.\.fromObjects, \.\.\.fromExcludesMerged\]/);
  assert.match(source, /remainingSurchargeLines/);
});
