/**
 * @case ERR-KUL-03
 * @summary KUL optional-tour contamination uses the same W18 raw-text boundary guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-03: the registry links this case to the KUL-02 W18 pattern', () => {
  const registry = read('docs/errors/product-registration.md');

  assert.match(registry, /ERR-KUL-03/);
  assert.match(registry, /ERR-KUL-02/);
  assert.match(registry, /W18/);
});

test('ERR-KUL-03: W18 checks every schedule activity against raw source text', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /pkg\.itinerary_data\?\.days/);
  assert.match(source, /for \(const day of pkg\.itinerary_data\.days\)/);
  assert.match(source, /for \(const item of day\.schedule \?\? \[\]\)/);
  assert.match(source, /item\.activity \?\? ''/);
  assert.match(source, /!rawText\.includes\(landmark\)/);
});
