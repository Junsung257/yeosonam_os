/**
 * @case ERR-20260418-05
 * @summary Taiwan/Taipei attraction matching must use the shared destination and ISO mapping instead of an unmapped region.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-05: destination ISO map includes Taipei/Taiwan aliases for attraction scope', () => {
  const source = read('src/lib/destination-iso.ts');

  assert.match(source, /'대만': 'TW'/);
  assert.match(source, /'타이베이': 'TW'/);
  assert.match(source, /'타이페이': 'TW'/);
  assert.match(source, /destinationToIsoSet/);
  assert.match(source, /inferCountryFromDestination/);
});

test('ERR-20260418-05: attraction enrichment combines package destination with day regions before matching', () => {
  const source = read('src/lib/itinerary-attraction-enricher.ts');

  assert.match(source, /const matchDestination = \[destination, \.\.\.dayRegions\]\.filter\(Boolean\)\.join\('\/'\)/);
  assert.match(source, /findMatchesForQueries\(compiledQueries, attractions, matchDestination\)/);
  assert.match(source, /destinationAllowsAttraction\(a, matchDestination\)/);
});
