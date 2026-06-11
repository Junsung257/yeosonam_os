/**
 * @case ERR-20260418-09
 * @summary optional_tours field shapes must stay polymorphic across parser,
 * ACL normalization, render contract, A4, and mobile surfaces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-09: parser asks for both legacy text price and numeric price fields', () => {
  const source = read('src/lib/parser.ts');

  assert.match(source, /"optional_tours": \[/);
  assert.match(source, /"price": "\$30\/인"/);
  assert.match(source, /"price_usd": 30/);
  assert.match(source, /"price_krw": null/);
  assert.match(source, /optional_tours: enrichOptionalToursRegion\(parsed\.optional_tours\)/);
});

test('ERR-20260418-09: package ACL normalizes string and numeric optional tour prices', () => {
  const source = read('src/lib/package-acl.ts');

  assert.match(source, /interface LegacyTour/);
  assert.match(source, /price\?: string \| number/);
  assert.match(source, /price_usd\?: number/);
  assert.match(source, /price_krw\?: number/);
  assert.match(source, /price: typeof t\.price === 'string' \? t\.price : \(t\.price != null \? String\(t\.price\) : null\)/);
  assert.match(source, /price_usd: t\.price_usd != null && !isNaN\(Number\(t\.price_usd\)\)/);
  assert.match(source, /price_krw: t\.price_krw != null && !isNaN\(Number\(t\.price_krw\)\)/);
});

test('ERR-20260418-09: render contract receives the shared optional tour shape', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /type OptionalTourInput/);
  assert.match(source, /optional_tours\?: OptionalTourInput\[] \| null/);
  assert.match(source, /resolveOptionalTours/);
  assert.match(source, /normalizeOptionalTour/);
  assert.match(source, /groupOptionalToursByRegion/);
});
