/**
 * @case ERR-public-eligibility-status-drift
 * @summary Public-status packages that fail the customer open contract must be demoted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-public-eligibility-status-drift: audit script can demote unsafe public package and product statuses', () => {
  const source = read('scripts/audit-package-public-eligibility.ts');
  const docs = read('docs/product-registration-current-ssot.md');

  assert.match(source, /args\.has\('--demote-unsafe-public'\)/);
  assert.match(source, /const blockers = getPackagePublicEligibilityBlockers\(row\)/);
  assert.match(source, /public_eligibility_demotion/);
  assert.match(source, /status: 'pending_review'/);
  assert.match(source, /audit_status: 'blocked'/);
  assert.match(source, /status: 'REVIEW_NEEDED'/);

  const blockersIndex = source.indexOf('const blockers = getPackagePublicEligibilityBlockers(row);');
  const packageDemotionIndex = source.indexOf("status: 'pending_review'");
  const productDemotionIndex = source.indexOf("status: 'REVIEW_NEEDED'");
  assert.ok(packageDemotionIndex > blockersIndex);
  assert.ok(productDemotionIndex > blockersIndex);

  assert.match(docs, /audit-package-public-eligibility\.ts --status=active,approved --limit=5000 --demote-unsafe-public --json/);
});
