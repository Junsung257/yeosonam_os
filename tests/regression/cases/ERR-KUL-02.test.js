/**
 * @case ERR-KUL-02
 * @summary KUL day-level landmark contamination must be caught by W18 raw-text checks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-02: TypeScript business rules warn when schedule landmarks are absent from raw text', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /W18/);
  assert.match(source, /ERR-KUL-02\/03/);
  assert.match(source, /for \(const landmark of LANDMARK_WHITELIST\)/);
  assert.match(source, /act\.includes\(landmark\) && !rawText\.includes\(landmark\)/);
  assert.match(source, /warnings\.push\(`\[W18 ERR-KUL-02\]/);
});

test('ERR-KUL-02: insert template keeps the same pre-insert W18 guard', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W18/);
  assert.match(source, /ERR-KUL-02\/03/);
  assert.match(source, /LANDMARK_WHITELIST/);
  assert.match(source, /act\.includes\(landmark\) && !rawText\.includes\(landmark\)/);
  assert.match(source, /warnings\.push\(`\[W18 ERR-KUL-02\]/);
});
