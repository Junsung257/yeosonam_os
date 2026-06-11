/**
 * @case ERR-catalog-table-itinerary-pollution
 * @summary Pasted catalog-table columns must be converted into structured
 * hotel, meal, and flight segments instead of leaking into customer schedule.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-catalog-table-itinerary-pollution: deterministic supplier facts own table itinerary recovery', () => {
  const source = read('src/lib/supplier-raw-deterministic-facts.ts');
  const unitTest = read('src/lib/supplier-raw-deterministic-facts.test.ts');

  assert.match(source, /buildCatalogTableItinerary/);
  assert.match(source, /catalogTableItinerary/);
  assert.match(source, /HOTEL|URL|PKG|일자|교통편|식사/);
  assert.match(unitTest, /keeps pasted catalog table columns out of the customer itinerary and notices/);
  assert.match(unitTest, /not\.toMatch/);
  assert.match(unitTest, /not\.toContain\(.*https:\/\/www\.unimat-golf\.jp/s);
  assert.match(unitTest, /type: 'flight'/);
});
