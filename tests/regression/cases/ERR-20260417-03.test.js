/**
 * @case ERR-20260417-03
 * @summary comma-separated attraction activities must still match multiple attraction cards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260417-03: A4 fallback uses shared multi-attraction matcher', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260417-03/);
  assert.match(source, /matchAttractions as matchAttractionsShared/);
  assert.match(source, /const single = matchAttractionShared\(activity/);
  assert.match(source, /const multi = matchAttractionsShared\(activity/);
  assert.match(source, /return \(multi\[0\] as unknown as AttractionInfo\) \|\| null/);
});

test('ERR-20260417-03: matcher has executable comma-split coverage', () => {
  const testSource = read('src/lib/attraction-matcher.test.ts');

  assert.match(testSource, /describe\('matchAttractions/);
  assert.match(testSource, /const r = matchAttractions\(/);
  assert.match(testSource, /expect\(names\)\.toContain/);
  assert.match(testSource, /expect\(r\)\.toEqual\(\[\]\)/);
});
