/**
 * @case ERR-HET-mobile-shopping-missing
 * @summary mobile detail must render shopping information from the shared terms section.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-mobile-shopping-missing: DetailClient renders the shared terms section with shopping view data', () => {
  const detail = read('src/app/packages/[id]/DetailClient.tsx');
  const terms = read('src/components/package/PackageTermsSection.tsx');

  assert.match(detail, /PackageTermsSection view=\{view\}/);
  assert.match(terms, /'inclusions' \| 'excludes' \| 'surchargesMerged' \| 'shopping' \| 'termsMisc'/);
  assert.match(terms, /const shoppingLine = view\.shopping\.displayLine \?\? view\.shopping\.text/);
  assert.match(terms, /const hasShopping =[\s\S]*!\/노쇼핑\/\.test/);
  assert.match(terms, /\{hasShopping && \(/);
});
