/**
 * @case ERR-regression-coverage-gap
 * @summary regression coverage reporting must connect documented ERR incidents to executable fixtures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-regression-coverage-gap: coverage script parses docs/errors and @case headers', () => {
  const source = read('tests/regression/err-coverage.js');
  const pkg = read('package.json');

  assert.match(source, /docs', 'errors', 'product-registration\.md'/);
  assert.match(source, /docs', 'errors', 'common\.md'/);
  assert.match(source, /@case\\s\+\(\[A-Z\]\[A-Za-z0-9_-\]\+/);
  assert.match(source, /covered = errs\.filter/);
  assert.match(source, /uncovered = errs\.filter/);
  assert.match(pkg, /"test:regression:coverage": "node tests\/regression\/err-coverage\.js"/);
  assert.match(pkg, /"test:regression:uncovered": "node tests\/regression\/err-coverage\.js --uncovered"/);
});
