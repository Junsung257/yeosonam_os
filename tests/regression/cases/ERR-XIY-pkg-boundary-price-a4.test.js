/**
 * @case ERR-XIY-pkg-boundary-price-a4
 * @summary Explicit PKG boundaries must beat weak variant labels, and A4
 * rendering must consume recovered title/price_dates instead of polluted
 * section text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-XIY-pkg-boundary-price-a4: product-registration v3 prioritizes explicit PKG boundaries', () => {
  const source = read('src/lib/product-registration-v3/product-registration-v3.test.ts');
  const planner = read('src/lib/product-registration-v3/structure-planner.ts');
  const facts = read('src/lib/supplier-raw-deterministic-facts.ts');

  assert.match(source, /uses explicit PKG boundaries before variant labels for Xian\/Huashan catalogs/);
  assert.match(source, /expect\(plan\.document_type\)\.toBe\('catalog'\)/);
  assert.match(source, /'PKG'/);
  assert.match(planner, /collectCatalogBoundaryStarts\(raw\)/);
  assert.match(planner, /const document_type = product_boundaries\.length > 1/);
  assert.match(planner, /\? 'catalog'/);
  assert.match(facts, /^(?=.*PKG)(?=.*출발일)(?=.*판매가)|판\s\*매\s\*가|출\s\*발\s\*일/s);
});

test('ERR-XIY-pkg-boundary-price-a4: A4 render path is driven by price_dates and title fields', () => {
  const a4 = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(a4, /renderPackage\(pkg as Parameters<typeof renderPackage>\[0\]\)/);
  assert.match(a4, /getEffectivePriceDates\(\{/);
  assert.match(a4, /price_dates: pkg\.price_dates/);
  assert.match(a4, /price_tiers: pkg\.price_tiers/);
  assert.match(a4, /const title = rawTitle/);
});
