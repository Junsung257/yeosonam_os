/**
 * @case ERR-HET-attraction-global-dedup
 * @summary duplicate attraction cards must be suppressed across the whole itinerary.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-attraction-global-dedup: seenAttractionIds is scoped outside day map', () => {
  const source = read('src/app/packages/[id]/DetailClient.tsx');

  assert.match(source, /ERR-HET-attraction-global-dedup/);
  assert.match(source, /const seenAttractionIds = new Set<string>\(\);\s*return days\.map/);
  assert.match(source, /seenAttractionIds\.has\(candidateKey\)/);
  assert.match(source, /seenAttractionIds\.add\(candidateKey\)/);
});
