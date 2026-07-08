/**
 * @case ERR-approve-public-contract-gate
 * @summary Legacy CLI approval must not publish from audit_status alone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-approve-public-contract-gate: approve_package requires public contract and proof before active promotion', () => {
  const source = read('db/approve_package.js');

  assert.match(source, /getApprovalBlockers\(p, \{ force \}\)/);
  assert.match(source, /customer_open_contract is missing/);
  assert.match(source, /mobile_browser_proof is missing/);
  assert.match(source, /mobile_browser_proof is stale for the current package row/);
  assert.match(source, /optional_tours contains customer-visible pollution/);
  assert.match(source, /itinerary_data has invalid attraction_ids/);

  const gateIndex = source.indexOf('const blockers = getApprovalBlockers(p, { force });');
  const activeUpdateIndex = source.indexOf(".update({ status: 'active'");
  const productActiveIndex = source.indexOf(".update({ status: 'ACTIVE'");
  assert.ok(gateIndex > 0, 'public-contract gate must be present');
  assert.ok(activeUpdateIndex > gateIndex, 'travel_packages active promotion must happen after the gate');
  assert.ok(productActiveIndex > gateIndex, 'products ACTIVE promotion must happen after the gate');
});
