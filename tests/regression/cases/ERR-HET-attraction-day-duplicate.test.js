/**
 * @case ERR-HET-attraction-day-duplicate
 * @summary duplicate attraction cards inside a day must be suppressed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-attraction-day-duplicate: mobile itinerary uses attraction ids/names as dedup keys', () => {
  const source = read('src/app/packages/[id]/DetailClient.tsx');

  assert.match(source, /ERR-HET-attraction-day-duplicate/);
  assert.match(source, /const seenAttractionIds = new Set<string>\(\)/);
  assert.match(source, /const candidateKey = attrCandidate\?\.id \|\| attrCandidate\?\.name \|\| null/);
  assert.match(source, /const isDuplicateInDay = !!\(candidateKey && seenAttractionIds\.has\(candidateKey\)\)/);
  assert.match(source, /const attr = isDuplicateInDay \? null : attrCandidate/);
});
