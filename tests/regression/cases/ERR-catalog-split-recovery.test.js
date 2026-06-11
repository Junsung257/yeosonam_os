/**
 * @case ERR-catalog-split-recovery
 * @summary Multi-PKG raw text must be deterministically recovered before
 * falling back to manual CATALOG_SPLIT_REQUIRED review.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-catalog-split-recovery: upload preparation runs deterministic recovery before fallback block', () => {
  const source = read('src/lib/product-registration/upload-registration-preparation.ts');
  const unitTest = read('src/lib/product-registration/upload-registration-preparation.test.ts');

  assert.match(source, /recoverCatalogSplitFromRawText/);
  assert.match(source, /parsedDocument\.multiProducts && parsedDocument\.multiProducts\.length >= 2/);
  assert.match(source, /if \(recoveredProducts\.length >= 2\)/);
  assert.match(source, /CATALOG_SPLIT_REQUIRED/);
  assert.match(source, /detectCatalogSplitFallback/);
  assert.match(unitTest, /recovers PKG catalog products from raw text before raising split fallback/);
  assert.match(unitTest, /blocks catalog split fallback before V3 preflight and saving/);
});
