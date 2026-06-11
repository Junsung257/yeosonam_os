/**
 * @case ERR-BHO-TB-03
 * @summary computeRawHash must remain exported from insert-template for registration scripts that need it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BHO-TB-03: insert-template defines and exports computeRawHash', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /function computeRawHash\(text\)/);
  assert.match(source, /crypto\.createHash\('sha256'\)\.update\(text\)\.digest\('hex'\)/);
  assert.match(source, /raw_text_hash: pkg\.raw_text_hash \|\| \(pkg\.raw_text \? computeRawHash\(pkg\.raw_text\) : null\)/);
  assert.match(source, /module\.exports = \{[\s\S]*computeRawHash[\s\S]*\}/);
});
