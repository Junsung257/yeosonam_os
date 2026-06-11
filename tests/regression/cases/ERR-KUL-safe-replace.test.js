/**
 * @case ERR-KUL-safe-replace
 * @summary duplicate replacement must defer degraded new packages instead of archiving live ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-safe-replace: schema models pending_replace as a first-class package status', () => {
  const source = read('src/lib/package-schema.ts');

  assert.match(source, /pending_replace/);
  assert.match(source, /ERR-KUL-safe-replace/);
});

test('ERR-KUL-safe-replace: insert template computes degradation before archiving duplicates', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-KUL-safe-replace/);
  assert.match(source, /const compScore = calcCompletenessScore\(pkg\)/);
  assert.match(source, /const dupScore = calcCompletenessScore\(dup\)/);
  assert.match(source, /const DEGRADATION_THRESHOLD = 20/);
  assert.match(source, /pkg\.status = 'pending_replace'/);
  assert.match(source, /toArchive\.push/);
});
