/**
 * @case ERR-hotel-grade-roomtype-mixed
 * @summary hotel grade, room type, and facility type must remain separate fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-hotel-grade-roomtype-mixed: registration changelog documents separated hotel fields', () => {
  const source = read('docs/register-changelog.md');

  assert.match(source, /ERR-hotel-grade-roomtype-mixed/);
  assert.match(source, /hotel\.grade/);
  assert.match(source, /hotel\.room_type/);
  assert.match(source, /hotel\.facility_type/);
  assert.match(source, /grade=null/);
});

test('ERR-hotel-grade-roomtype-mixed: type and normalizer keep grade normalization scoped to grade only', () => {
  const types = read('src/types/itinerary.ts');
  const normalizer = read('src/lib/itinerary-normalizer.ts');

  assert.match(types, /room_type:\s+string \| null/);
  assert.match(normalizer, /function normalizeHotelGrade/);
  assert.match(normalizer, /grade: normalizeHotelGrade\(day\.hotel\.grade\)/);
  assert.equal(normalizer.includes('normalizeHotelGrade(day.hotel.room_type'), false);
});
