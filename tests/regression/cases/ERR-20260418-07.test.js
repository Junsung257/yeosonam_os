/**
 * @case ERR-20260418-07
 * @summary A4 schedule pagination must use conservative day-height estimates
 * so late-day schedule rows are not silently clipped by overflow hidden.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-07: A4 template keeps conservative per-day height budgeting', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-20260418-07/);
  assert.match(source, /const estimateDayHeight = \(day: DaySchedule\) => \{/);
  assert.match(source, /const routeH = 40/);
  assert.match(source, /const flightBarH = day\.schedule\?\.some\(s => s\.type === 'flight'\) \? 50 : 0/);
  assert.match(source, /const actH = activities \* 42/);
  assert.match(source, /const noteH = \(day\.schedule\?\.filter\(s => s\.note\)\?\.length \|\| 0\) \* 18/);
  assert.match(source, /const hotelMealH = 45/);
  assert.match(source, /const PAGE_CONTENT_HEIGHT = 950/);
});

test('ERR-20260418-07: A4 template splits day chunks before page budget overflow', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /const dayChunks: DaySchedule\[\]\[\] = \[\]/);
  assert.match(source, /let currentHeight = 0/);
  assert.match(source, /const h = estimateDayHeight\(day\)/);
  assert.match(source, /currentHeight \+ h > PAGE_CONTENT_HEIGHT/);
  assert.match(source, /dayChunks\.push\(currentChunk\)/);
  assert.match(source, /currentChunk = \[day\]/);
  assert.match(source, /currentHeight = h/);
});
