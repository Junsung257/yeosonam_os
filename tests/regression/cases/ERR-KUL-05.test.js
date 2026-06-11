/**
 * @case ERR-KUL-05
 * @summary renderers must consume the canonical render contract instead of reparsing raw package fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-05: render contract documents central ownership of shared render fields', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /ERR-KUL-05/);
  assert.match(source, /export interface CanonicalView/);
  assert.match(source, /airlineHeader: AirlineHeader/);
  assert.match(source, /flightHeader: FlightHeader/);
  assert.match(source, /surchargesMerged: MergedSurcharge\[\]/);
  assert.match(source, /shopping: CanonicalShopping/);
});

test('ERR-KUL-05: A4 and mobile renderers explicitly consume the canonical view', () => {
  const a4 = read('src/components/admin/YeosonamA4Template.tsx');
  const mobile = read('src/app/packages/[id]/DetailClient.tsx');
  const integration = read('src/lib/render-contract.integration.test.ts');

  assert.match(a4, /renderPackage/);
  assert.match(a4, /ERR-KUL-05/);
  assert.match(mobile, /ERR-KUL-05/);
  assert.match(mobile, /view\.flightHeader/);
  assert.match(integration, /ERR-KUL-05/);
});
