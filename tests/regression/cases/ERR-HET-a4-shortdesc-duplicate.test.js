/**
 * @case ERR-HET-a4-shortdesc-duplicate
 * @summary A4 attraction short descriptions should render once per matched attraction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-a4-shortdesc-duplicate: A4 tracks rendered attraction descriptions globally', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-HET-a4-shortdesc-duplicate/);
  assert.match(source, /const seenAttractionIdsForDesc = new Set<string>\(\)/);
  assert.match(source, /const dedupKey = attr\?\.name \|\| `\$\{day\.day\}-\$\{sIdx\}-\$\{desc\}`/);
  assert.match(source, /if \(seenAttractionIdsForDesc\.has\(dedupKey\)\) return null/);
  assert.match(source, /seenAttractionIdsForDesc\.add\(dedupKey\)/);
});
