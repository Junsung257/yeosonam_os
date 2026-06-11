/**
 * @case ERR-HET-activity-desc-duplicate
 * @summary A4 activity rendering must not print the same parenthetical description twice.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-activity-desc-duplicate: A4 splits POI name/description only for unmatched non-special rows', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-HET-activity-desc-duplicate/);
  assert.match(source, /function splitPoi\(activity: string\)/);
  assert.match(source, /const \{ poiName, poiDesc \} = splitPoi\(item\.activity\)/);
  assert.match(source, /const displayName = \(attr \|\| isSpecial\) \? item\.activity : poiName/);
  assert.match(source, /const displayDesc = \(!attr && !isSpecial && poiDesc\) \? poiDesc : null/);
});
