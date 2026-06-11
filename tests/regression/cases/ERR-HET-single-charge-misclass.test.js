/**
 * @case ERR-HET-single-charge-misclass
 * @summary single-room charges must stay basic excludes, not period surcharges.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-single-charge-misclass: surcharge regex notes room-based charge exclusion', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /ERR-HET-single-charge-misclass/);
  assert.match(source, /export const SURCHARGE_RE/);
  assert.doesNotMatch(source, /SURCHARGE_RE = [^;]*싱글차지/);
});

test('ERR-HET-single-charge-misclass: unit and integration tests preserve the behavior', () => {
  const unit = read('src/lib/render-contract.test.ts');
  const integration = read('src/lib/render-contract.integration.test.ts');

  assert.match(unit, /ERR-HET-single-charge-misclass/);
  assert.match(unit, /SURCHARGE_RE\.test/);
  assert.match(unit, /toBe\(false\)/);
  assert.match(integration, /ERR-HET-single-charge-misclass/);
});
