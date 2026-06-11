/**
 * @case ERR-20260418-01
 * @summary min_participants must be checked against raw source text instead of template defaults.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-01: TypeScript business rules compare raw minimum participants', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /W13/);
  assert.match(source, /ERR-20260418-01/);
  assert.match(source, /rawText\.match\(\/\(\?:/);
  assert.match(source, /const rawMin = Number\(m\[1\]\)/);
  assert.match(source, /pkg\.min_participants != null && pkg\.min_participants !== rawMin/);
  assert.match(source, /warnings\.push\(`\[W13 ERR-20260418-01\]/);
});

test('ERR-20260418-01: insert template has the same semantic guard', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W13/);
  assert.match(source, /ERR-20260418-01/);
  assert.match(source, /const mpMatch = rawText\.match\(\/\(\?:/);
  assert.match(source, /const rawMin = Number\(mpMatch\[1\]\)/);
  assert.match(source, /pkg\.min_participants != null && pkg\.min_participants !== rawMin/);
});
