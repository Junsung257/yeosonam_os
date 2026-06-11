/**
 * @case ERR-KUL-01
 * @summary departure_days must not be stored as a JSON array string such as
 * ["Fri"], because that leaks raw JSON into A4/mobile UI labels.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-01: TypeScript business rules warn on JSON-array departure_days strings', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /departure_days\?: string \| string\[] \| null/);
  assert.match(source, /W16/);
  assert.match(source, /ERR-KUL-01/);
  assert.match(source, /typeof pkg\.departure_days === 'string'/);
  assert.match(source, /const dd = pkg\.departure_days\.trim\(\)/);
  assert.match(source, /dd\.startsWith\('\['\) && dd\.endsWith\('\]'\)/);
  assert.match(source, /warnings\.push\(`\[W16 ERR-KUL-01\]/);
});

test('ERR-KUL-01: DB insert template keeps the same departure_days warning', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W16/);
  assert.match(source, /ERR-KUL-01/);
  assert.match(source, /typeof pkg\.departure_days === 'string'/);
  assert.match(source, /const dd = pkg\.departure_days\.trim\(\)/);
  assert.match(source, /dd\.startsWith\('\['\) && dd\.endsWith\('\]'\)/);
  assert.match(source, /warnings\.push\(`\[W16 ERR-KUL-01\]/);
});
