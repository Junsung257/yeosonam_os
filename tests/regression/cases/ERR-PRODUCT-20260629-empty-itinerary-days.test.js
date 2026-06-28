/**
 * @case ERR-PRODUCT-20260629-empty-itinerary-days
 * @summary Empty itinerary-day repair must stay a conservative free-time
 * fallback and must not create or query attraction records.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function emptyItineraryRepairBlock() {
  const source = read('scripts/audit-product-mobile-landing-readiness.mjs');
  const match = source.match(/function repairEmptyItineraryDaysQuality\(pkg\) \{[\s\S]*?\n\}\n\nfunction hasUnresolvedCodeOrDestination/);
  assert.ok(match, 'repairEmptyItineraryDaysQuality block must exist');
  return match[0];
}

test('empty itinerary repair is explicitly gated by its own flag and report type', () => {
  const source = read('scripts/audit-product-mobile-landing-readiness.mjs');

  assert.match(source, /--repair-empty-itinerary-days/);
  assert.match(source, /repairEmptyItineraryDays/);
  assert.match(source, /repaired_empty_itinerary_days/);
  assert.match(source, /type: 'empty_itinerary_days'/);
});

test('empty itinerary repair writes only free-time fallback schedule rows', () => {
  const block = emptyItineraryRepairBlock();

  assert.match(block, /entity_kind: 'free_time'/);
  assert.match(block, /type: 'free_time'/);
  assert.match(block, /attraction_query: null/);
  assert.match(block, /service_name: null/);
  assert.match(block, /service_detail: null/);
  assert.doesNotMatch(block, /attraction_ids/);
  assert.doesNotMatch(block, /attraction_names/);
});

test('empty itinerary repair does not create or upsert attraction records', () => {
  const block = emptyItineraryRepairBlock();

  assert.doesNotMatch(block, /\.from\(['"]attractions['"]\)/);
  assert.doesNotMatch(block, /\.insert\(/);
  assert.doesNotMatch(block, /\.upsert\(/);
});
