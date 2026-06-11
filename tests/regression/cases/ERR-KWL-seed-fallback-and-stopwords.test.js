/**
 * @case ERR-KWL-seed-fallback-and-stopwords
 * @summary attraction candidate extraction must block standalone generic seeds while preserving real candidates.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-KWL-seed-fallback-and-stopwords: extractor has exact standalone stopword protection', () => {
  const source = read('src/lib/itinerary-attraction-candidates.ts');

  assert.match(source, /STANDALONE_STOP_WORDS/);
  assert.match(source, /STANDALONE_STOP_WORDS\.has\(t\)/);
  assert.match(source, /STANDALONE_STOP_WORDS\.has\(tNoSpace\)/);
  assert.match(source, /extractAttractionCandidates/);
});

test('ERR-KWL-seed-fallback-and-stopwords: unit tests pin generic words and fallback examples', () => {
  const source = read('src/lib/itinerary-attraction-candidates.test.ts');

  assert.match(source, /\[ERR-KWL\]/);
  assert.match(source, /not\.toContain\('맛집'\)/);
  assert.match(source, /not\.toContain\('카페'\)/);
  assert.match(source, /x\.includes\('동서항'\)/);
  assert.match(source, /발마사지/);
});
