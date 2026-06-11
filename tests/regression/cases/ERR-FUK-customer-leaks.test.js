/**
 * @case ERR-FUK-customer-leaks
 * @summary Internal notes, numeric commas, duplicate surcharge lines, and
 * flight-code parsing regressions must stay blocked by the render contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-customer-leaks: shopping fallback does not expose special_notes/internal keywords', () => {
  const source = read('src/lib/render-contract.ts');
  const integrationTest = read('src/lib/render-contract.integration.test.ts');

  assert.match(source, /ERR-FUK-customer-leaks/);
  assert.match(source, /const INTERNAL_KEYWORDS = \/.*commission_rate.*LAND_OPERATOR/);
  assert.match(source, /special_notes\?: string \| null/);
  assert.match(source, /special_notes.*fallback.*ERR-special-notes-leak/);
  assert.match(source, /export function resolveShopping/);
  assert.match(integrationTest, /ERR-FUK-customer-leaks: special_notes/);
  assert.match(integrationTest, /resolveShopping/);
});

test('ERR-FUK-customer-leaks: render contract protects numeric commas and surcharge dedupe path', () => {
  const source = read('src/lib/render-contract.ts');
  const unitTest = read('src/lib/render-contract.test.ts');

  assert.match(source, /export function flattenItems\(items: string\[\]\): string\[\]/);
  assert.match(source, /shouldSplitAtComma\(item, i, depth\)/);
  assert.match(source, /export function classifyExcludes/);
  assert.match(source, /surchargesMerged/);
  assert.match(unitTest, /"2,000/);
  assert.match(unitTest, /classifyExcludes/);
});

test('ERR-FUK-customer-leaks: flight parsing helpers strip code-prefixed airport labels', () => {
  const source = read('src/lib/render-contract.ts');
  const unitTest = read('src/lib/render-contract.test.ts');

  assert.match(source, /export function parseCityFromActivity/);
  assert.match(source, /activity\.replace\(\/\^\[A-Z0-9\]\{2,5\}\\s\+\//);
  assert.match(source, /export function parseFlightActivity/);
  assert.match(source, /export function formatFlightLabel/);
  assert.match(unitTest, /BX143/);
  assert.match(unitTest, /parseFlightActivity/);
});
