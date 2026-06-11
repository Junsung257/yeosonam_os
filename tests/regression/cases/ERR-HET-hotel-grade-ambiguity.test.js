/**
 * @case ERR-HET-hotel-grade-ambiguity
 * @summary hotel star rendering must preserve the original grade text label.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-hotel-grade-ambiguity: mobile hotel card renders grade label next to stars', () => {
  const source = read('src/app/packages/[id]/DetailClient.tsx');

  assert.match(source, /ERR-HET-hotel-grade-ambiguity/);
  assert.match(source, /const label = gradeLabel\.trim\(\)/);
  assert.match(source, /\{label\}<\/span>/);
  assert.match(source, /numericOnly/);
  assert.match(source, /\{n\}.*<\/span>/);
});
