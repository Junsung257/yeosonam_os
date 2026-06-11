/**
 * @case ERR-itinerary-detail-flight-card-and-appendix
 * @summary DAY flight cards must remain detailed, while trailing menu,
 * cancellation, and cash-receipt appendices stay out of schedules.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-itinerary-detail-flight-card-and-appendix: deterministic facts strip shared appendices', () => {
  const source = read('src/lib/supplier-raw-deterministic-facts.ts');
  const supplierTest = read('src/lib/supplier-raw-deterministic-facts.test.ts');
  const dayTable = read('src/lib/parser/deterministic/day-table.ts');

  assert.match(source, /appendixPatterns/);
  assert.match(source, /현금영수증/);
  assert.match(source, /취소규정/);
  assert.match(supplierTest, /not\.toContain\(.*현금영수증/s);
  assert.match(supplierTest, /not\.toContain\(.*취소/s);
  assert.match(dayTable, /현금영수증 발급 안내/);
  assert.match(dayTable, /취소규정 안내/);
});

test('ERR-itinerary-detail-flight-card-and-appendix: flight segments stay in day schedule detail', () => {
  const supplierTest = read('src/lib/supplier-raw-deterministic-facts.test.ts');
  const promotionWorkflow = read('src/lib/product-registration/promotion-workflow.ts');

  assert.match(supplierTest, /type: 'flight'/);
  assert.match(supplierTest, /transport: 'BX112'/);
  assert.match(supplierTest, /transport: 'BX111'/);
  assert.match(supplierTest, /flight_segments/);
  assert.match(promotionWorkflow, /detailed flight cards/i);
});
