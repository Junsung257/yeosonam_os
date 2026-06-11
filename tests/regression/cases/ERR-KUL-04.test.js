/**
 * @case ERR-KUL-04
 * @summary Ambiguous optional tour names need region propagation so A4 and
 * mobile render the same labels.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KUL-04: parser prompt and post-processing preserve optional tour regions', () => {
  const source = read('src/lib/parser.ts');

  assert.match(source, /optional_tours\.region/);
  assert.match(source, /enrichOptionalToursRegion\(parsed\.optional_tours\)/);
  assert.match(source, /섹션 헤더/);
  assert.match(source, /2층버스/);
  assert.match(source, /리버보트/);
});

test('ERR-KUL-04: shared itinerary renderer infers region and display name consistently', () => {
  const source = read('src/lib/itinerary-render.ts');

  assert.match(source, /function inferRegion/);
  assert.match(source, /REGION_KEYWORD_MAP/);
  assert.match(source, /stripRegionFromName/);
  assert.match(source, /const displayName = region \? `\$\{baseName\} \(\$\{region\}\)` : baseName/);
  assert.match(source, /groupOptionalToursByRegion/);
});

test('ERR-KUL-04: business rules keep ambiguous no-region optional tours visible', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /W17/);
  assert.match(source, /ERR-KUL-04/);
  assert.match(source, /AMBIGUOUS_OT/);
  assert.match(source, /optional_tours/);
  assert.match(source, /region/);
});
