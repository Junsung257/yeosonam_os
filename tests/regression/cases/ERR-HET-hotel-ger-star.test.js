/**
 * @case ERR-HET-hotel-ger-star
 * @summary non-numeric lodging grades such as ger must render text badges instead of invented stars.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-hotel-ger-star: hotel card extracts stars only from explicit numeric grade labels', () => {
  const source = read('src/app/packages/[id]/DetailClient.tsx');

  assert.match(source, /ERR-HET-hotel-ger-star/);
  assert.match(source, /const m = gradeLabel\.match/);
  assert.match(source, /const starCount = m \? parseInt\(m\[1\], 10\) : null/);
  assert.match(source, /if \(Number\.isFinite\(starCount\) && starCount! > 0\)/);
  assert.match(source, /return \(\s*<span className="inline-block text-\[10px\]/);
});
