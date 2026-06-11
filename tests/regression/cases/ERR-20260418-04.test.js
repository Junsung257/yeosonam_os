/**
 * @case ERR-20260418-04
 * @summary Optional tour prices stored as either "$50/person" text or numeric
 * USD/KRW fields must survive into A4/mobile rendering.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-04: canonical optional tour input accepts text and numeric prices', () => {
  const source = read('src/lib/itinerary-render.ts');

  assert.match(source, /export interface OptionalTourInput/);
  assert.match(source, /price\?: string \| null/);
  assert.match(source, /price_usd\?: number \| null/);
  assert.match(source, /price_krw\?: number \| null/);
  assert.match(source, /function formatTourPrice/);
  assert.match(source, /if \(tour\.price && String\(tour\.price\)\.trim\(\)\)/);
  assert.match(source, /typeof tour\.price_usd === 'number' && tour\.price_usd > 0/);
  assert.match(source, /typeof tour\.price_krw === 'number' && tour\.price_krw > 0/);
});

test('ERR-20260418-04: A4 print path reparses canonical text prices into numeric fields', () => {
  const source = read('src/app/itinerary/[id]/print/page.tsx');

  assert.match(source, /function parseTourPrices/);
  assert.match(source, /price\.match\(\/\\\$\(\[0-9\]\+\(\?:\\\.\[0-9\]\+\)\?\)\/\)/);
  assert.match(source, /price_usd: usd \? Number\(usd\[1\]\) : null/);
  assert.match(source, /price_krw: krw \? Number\(krw\[1\]\.replace\(\/,\/g, ''\)\) : null/);
  assert.match(source, /\.\.\.parseTourPrices\(t\.price\)/);
});
