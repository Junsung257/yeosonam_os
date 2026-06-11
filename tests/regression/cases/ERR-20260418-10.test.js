/**
 * @case ERR-20260418-10
 * @summary PACKAGE_LIST_FIELDS must keep surcharge fields so customer/A4 render paths cannot silently drop surcharge periods.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRoute() {
  return fs.readFileSync(path.join(process.cwd(), 'src/app/api/packages/route.ts'), 'utf8');
}

function extractPackageListFields(source) {
  const match = source.match(/const PACKAGE_LIST_FIELDS = `([\s\S]*?)`;/);
  assert.ok(match, 'PACKAGE_LIST_FIELDS constant must exist');
  return match[1];
}

test('ERR-20260418-10: package list SELECT includes raw and normalized surcharge fields', () => {
  const fields = extractPackageListFields(readRoute());

  assert.match(fields, /\bsurcharges\b/, 'surcharges must remain in PACKAGE_LIST_FIELDS');
  assert.match(fields, /\bnormalized_surcharges\b/, 'normalized_surcharges must remain in PACKAGE_LIST_FIELDS');
  assert.match(fields, /\bguide_tip\b/, 'guide_tip must remain available for surcharge rendering');
  assert.match(fields, /\bsingle_supplement\b/, 'single_supplement must remain available for surcharge rendering');
  assert.match(fields, /\bsmall_group_surcharge\b/, 'small_group_surcharge must remain available for surcharge rendering');
});

test('ERR-20260418-10: API drift audit is wired as the durable guard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['audit:api-drift'], 'node db/audit_api_field_drift.js');
  assert.ok(
    Object.values(pkg.scripts).some((script) => String(script).includes('audit_api_field_drift')),
    'api drift audit must remain discoverable from package scripts',
  );
});
