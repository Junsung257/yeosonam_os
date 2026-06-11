/**
 * @case ERR-20260417-02
 * @summary price_tiers confirmed status and note must flow into price_dates.confirmed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260417-02: shared price date conversion preserves confirmed state', () => {
  const source = read('src/lib/price-dates.ts');

  assert.match(source, /const isConfirmed = tier\.status === 'confirmed'\s*\|\|[\s\S]*tier\.note[\s\S]*confirmed: isConfirmed/);
});

test('ERR-20260417-02: insert template conversion and validator both guard confirmed drift', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /const isConfirmed = tier\.status === 'confirmed'\s*\|\|[\s\S]*tier\.note[\s\S]*confirmed: !!isConfirmed/);
  assert.match(source, /const hasConfirmStatus = pkg\.price_tiers\.some\(t => t\.status === 'confirmed'\)/);
  assert.match(source, /const pdConfirmed = Array\.isArray\(pd\) && pd\.some\(p => p\.confirmed\)/);
});

test('ERR-20260417-02: unit tests cover status, note, and poster grouping preservation', () => {
  const testSource = read('src/lib/price-dates.test.ts');

  assert.match(testSource, /confirmed status[\s\S]*confirmed\)\.toBe\(true\)/);
  assert.match(testSource, /note[\s\S]*confirmed\)\.toBe\(true\)/);
  assert.match(testSource, /confirmed[\s\S]*find\(d => d\.day === 2\)\?\.confirmed\)\.toBe\(true\)/);
});
