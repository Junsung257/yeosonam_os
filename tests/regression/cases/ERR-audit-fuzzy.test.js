/**
 * @case ERR-audit-fuzzy
 * @summary render-vs-source audits must compare normalized entity keys so
 * whitespace, parentheses, and separator characters do not create false alarms.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-audit-fuzzy: audit_render_vs_source normalizes entity strings before set diff', () => {
  const source = read('db/audit_render_vs_source.js');

  assert.match(source, /function normalizeEntity\(s\) \{/);
  assert.match(source, /\.replace\(\/\\s\+\/g, ''\)/);
  assert.match(source, /\.replace\(\/\\\(\[\^\)\]\*\\\)\/g, ''\)/);
  assert.match(source, /\.replace\(\/\[·&\]\/g, ''\)/);
  assert.match(source, /\.toLowerCase\(\)/);
  assert.match(source, /function setDiff\(a, b\) \{/);
  assert.match(source, /aMap\.set\(normalizeEntity\(x\), x\)/);
  assert.match(source, /bMap\.set\(normalizeEntity\(x\), x\)/);
});
