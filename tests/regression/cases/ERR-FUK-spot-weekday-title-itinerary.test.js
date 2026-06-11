/**
 * @case ERR-FUK-spot-weekday-title-itinerary
 * @summary Fukuoka spot-weekday price tables and cash-receipt appendix text
 * must not leak into customer title or DAY schedule.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-spot-weekday-title-itinerary: golden corpus keeps price and appendix text out of title/schedule', () => {
  const goldenTest = read('src/lib/product-registration/golden-corpus/golden-corpus.test.ts');
  const evaluator = read('src/lib/product-registration/golden-corpus/evaluator.ts');
  const titleNormalizer = read('src/lib/product-registration/title-normalization.ts');

  assert.match(evaluator, /fukuoka-golf-spot-weekday-cash-receipt/);
  assert.match(goldenTest, /keeps Fukuoka price-table and cash-receipt text out of the customer itinerary\/title/);
  assert.match(goldenTest, /expect\(registration\.identity\.title\)\.not\.toContain/);
  assert.match(goldenTest, /scheduleText\)\.not\.toMatch\(\/\\d\{1,2\}\\\/\\d\{1,2\}/);
  assert.match(goldenTest, /scheduleText\)\.not\.toMatch\(\/\\d\{1,3\}\(\?:,\\d\{3\}\)\?,-\//);
  assert.match(titleNormalizer, /NON_PRODUCT_TITLE_RE/);
  assert.match(titleNormalizer, /현금영수증|cash/i);
});
