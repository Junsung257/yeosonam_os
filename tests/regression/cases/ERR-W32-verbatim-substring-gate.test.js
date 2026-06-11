/**
 * @case ERR-W32-verbatim-substring-gate
 * @summary insert-time validation must detect schedule and inclusion text that is not a raw_text substring.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-W32-verbatim-substring-gate: validatePackage checks schedule and inclusions against normalized raw_text', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W32 — ERR-FUK-camellia-overcorrect/);
  assert.match(source, /const normalize = \(s\) => \(s \|\| ''\)\.replace\(\/\\s\+\/g, ''\)/);
  assert.match(source, /const rawN = normalize\(rawText\)/);
  assert.match(source, /violations\.push\(`Day\$\{d\.day\} schedule/);
  assert.match(source, /violations\.push\(`inclusions "\$\{inc\}"/);
  assert.match(source, /raw_text substring 매칭 실패/);
});
