/**
 * @case ERR-product-prices-customer-options
 * @summary Customer package pages must use customer-safe product_prices rows with adult_selling_price, not internal net price fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('ERR-product-prices-customer-options: package detail fetches only customer-safe price columns', () => {
  const page = read('src/app/packages/[id]/page.tsx');

  assert.match(page, /\.from\('product_prices'\)[\s\S]{0,260}\.select\('target_date, adult_selling_price, note'\)/);
  assert.doesNotMatch(page, /\.from\('product_prices'\)[\s\S]{0,260}\.select\([^)]*net_price/);
  assert.doesNotMatch(page, /\.from\('product_prices'\)[\s\S]{0,260}\.select\([^)]*margin_rate/);
});

test('ERR-product-prices-customer-options: client payload sanitizer strips internal product price fields', () => {
  const sanitizer = read('src/lib/customer-package-payload.ts');

  assert.match(sanitizer, /function sanitizeProductPrices/);
  assert.match(sanitizer, /adult_selling_price/);
  assert.doesNotMatch(
    sanitizer.match(/function sanitizeProductPrices[\s\S]*?function sanitizeNestedProductRecord/)?.[0] ?? '',
    /\bnet_price\b|\bmargin_rate\b|\bcost_price\b/,
    'sanitizeProductPrices must not pass through internal price fields',
  );
});

test('ERR-product-prices-customer-options: deliverability gate blocks missing customer selling prices', () => {
  const gate = read('src/lib/product-registration/deliverability-gate.ts');

  assert.match(gate, /adult_selling_price missing for positive product_prices row/);
  assert.match(gate, /product_prices invalid adult_selling_price/);
});
