/**
 * @case ERR-FUK-rawtext-pollution
 * @summary raw_text must stay original and hash-verified for post-register audits.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-rawtext-pollution: insert template requires raw_text and raw_text_hash', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-FUK-rawtext-pollution/);
  assert.match(source, /raw_text/);
  assert.match(source, /raw_text_hash/);
  assert.match(source, /computeRawHash\(pkg\.raw_text\)/);
});

test('ERR-FUK-rawtext-pollution: post-register audit verifies raw_text integrity', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /ERR-FUK-rawtext-pollution/);
  assert.match(source, /function checkRawTextIntegrity\(pkg\)/);
  assert.match(source, /crypto\.createHash\('sha256'\)\.update\(pkg\.raw_text\)\.digest\('hex'\)/);
  assert.match(source, /pkg\.raw_text_hash !== actualHash/);
});
