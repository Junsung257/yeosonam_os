/**
 * @case ERR-PHU-itinerary-pollution
 * @summary Phu Quoc full-upload table fragments such as flight codes and times
 * must be removed from customer schedule activities.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-PHU-itinerary-pollution: registerProductFromRaw test covers polluted schedule removal', () => {
  const unitTest = read('src/lib/product-registration/register-product-from-raw.test.ts');
  const qualityGate = read('src/lib/product-registration/itinerary-quality-gate.ts');

  assert.match(unitTest, /phu-quoc-full-upload/);
  assert.match(unitTest, /keeps Phu Quoc catalog column fragments out of schedule activities/);
  assert.match(unitTest, /not\.toEqual\(expect\.arrayContaining\(\['ZE981', '18:55', '22:25'\]\)\)/);
  assert.match(unitTest, /removedPollutedScheduleItems\.length\)\.toBeGreaterThan\(0\)/);
  assert.match(qualityGate, /classifyPollutedActivity/);
});
